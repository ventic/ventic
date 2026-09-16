package com.ventic.app

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.text.SubtitleParser
import java.io.ByteArrayOutputStream
import java.io.EOFException

/**
 * Gives an MPEG-4 Part 2 (XviD, DivX) track the decoder header its container
 * left out.
 *
 * XviD's own muxer writes an MP4 whose `esds` has no DecoderSpecificInfo: the
 * VOS/VOL header that says how the picture is coded exists only in-band, at the
 * front of the first keyframe. FFmpeg (mpv, every other player) reads it from
 * there. media3 (1.8.0) instead reads whatever descriptor comes next as that
 * header without checking its tag — here the one-byte SLConfig, so MediaCodec is
 * configured with `csd-0 = 02` — and the Exynos decoder on a Pixel rejects the
 * very first frame (`work failed to complete: 14`) of a film it plays without a
 * complaint once the header is right. Measured on
 * `Mutiny.2026…XviD.AC3-MAXX.mp4`: the untouched file fails, an `ffmpeg -c copy`
 * of it (which writes the header into `esds`) plays, and the frames are
 * byte-for-byte the same.
 *
 * So a `video/mp4v-es` track whose initialisation data doesn't open on a start
 * code — none, or that stray byte — holds its format back until the first
 * sample, and is then announced with everything in front of that sample's first
 * VOP start code as its `csd-0`, which is what media3's own TS reader does for
 * the same codec. Every other track passes straight through.
 */
@androidx.annotation.OptIn(UnstableApi::class)
class Mpeg4Headers(private val inner: ExtractorsFactory) : ExtractorsFactory {
  override fun createExtractors(): Array<Extractor> = inner.createExtractors().map(::Wrapped).toTypedArray()

  override fun createExtractors(uri: Uri, responseHeaders: Map<String, List<String>>): Array<Extractor> =
    inner.createExtractors(uri, responseHeaders).map(::Wrapped).toTypedArray()

  // DefaultMediaSourceFactory sets up subtitle parsing through these, and the
  // interface's own defaults would quietly do nothing with it.
  override fun setSubtitleParserFactory(factory: SubtitleParser.Factory) =
    apply { inner.setSubtitleParserFactory(factory) }

  @Deprecated("Forwarded for as long as DefaultMediaSourceFactory still calls it")
  @Suppress("DEPRECATION")
  override fun experimentalSetTextTrackTranscodingEnabled(enabled: Boolean) =
    apply { inner.experimentalSetTextTrackTranscodingEnabled(enabled) }

  override fun experimentalSetCodecsToParseWithinGopSampleDependencies(codecs: Int) =
    apply { inner.experimentalSetCodecsToParseWithinGopSampleDependencies(codecs) }

  private class Wrapped(private val inner: Extractor) : Extractor {
    override fun sniff(input: ExtractorInput) = inner.sniff(input)

    override fun getSniffFailureDetails() = inner.sniffFailureDetails

    override fun init(output: ExtractorOutput) {
      val tracks = HashMap<Int, TrackOutput>()
      inner.init(object : ExtractorOutput {
        override fun track(id: Int, type: Int) = tracks.getOrPut(id) {
          output.track(id, type).let { if (type == C.TRACK_TYPE_VIDEO) Held(it) else it }
        }

        override fun endTracks() = output.endTracks()

        override fun seekMap(seekMap: SeekMap) = output.seekMap(seekMap)
      })
    }

    override fun read(input: ExtractorInput, seekPosition: PositionHolder) = inner.read(input, seekPosition)

    override fun seek(position: Long, timeUs: Long) = inner.seek(position, timeUs)

    override fun release() = inner.release()

    // The progressive source looks through to the real class (an MP3 stream has
    // its seeking switched off that way).
    override fun getUnderlyingImplementation(): Extractor = inner.underlyingImplementation
  }

  private class Held(private val out: TrackOutput) : TrackOutput {
    /** The format being held back until the first sample shows what it lacks. */
    private var waiting: Format? = null
    private var seen = false
    private var header: ByteArray? = null
    private val bytes = ByteArrayOutputStream()

    override fun format(format: Format) {
      val lacking = format.sampleMimeType == MimeTypes.VIDEO_MP4V && !startsWithStartCode(format.initializationData.firstOrNull())
      when {
        !lacking -> {
          waiting = null
          out.format(format)
        }
        !seen -> waiting = format
        else -> out.format(completed(format))
      }
    }

    override fun durationUs(durationUs: Long) = out.durationUs(durationUs)

    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
      if (waiting == null) return out.sampleData(input, length, allowEndOfInput, sampleDataPart)
      val chunk = ByteArray(length)
      val read = input.read(chunk, 0, length)
      if (read == C.RESULT_END_OF_INPUT) {
        if (allowEndOfInput) return read
        throw EOFException()
      }
      bytes.write(chunk, 0, read)
      return read
    }

    override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
      if (waiting == null) return out.sampleData(data, length, sampleDataPart)
      val chunk = ByteArray(length)
      data.readBytes(chunk, 0, length)
      bytes.write(chunk)
    }

    override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
      waiting?.let { format ->
        waiting = null
        seen = true
        val all = bytes.toByteArray()
        bytes.reset()
        // Anything in front of this sample is a read a seek abandoned.
        val start = (all.size - offset - size).coerceAtLeast(0)
        header = headerOf(all, start, all.size - offset)
        out.format(completed(format))
        out.sampleData(ParsableByteArray(all.copyOfRange(start, all.size)), all.size - start, TrackOutput.SAMPLE_DATA_PART_MAIN)
      }
      out.sampleMetadata(timeUs, flags, size, offset, cryptoData)
    }

    private fun completed(format: Format) =
      header?.let { format.buildUpon().setInitializationData(listOf(it)).build() } ?: format

    /** Everything before the first VOP start code (00 00 01 B6), if anything is. */
    private fun headerOf(b: ByteArray, from: Int, to: Int): ByteArray? {
      for (i in from until to - 3) {
        if (startCodeAt(b, i) && b[i + 3] == 0xB6.toByte()) {
          return if (i > from && startCodeAt(b, from)) b.copyOfRange(from, i) else null
        }
      }
      return null
    }

    /** A real VOS/VO/VOL header opens on a start code; anything else is not one. */
    private fun startsWithStartCode(b: ByteArray?) = b != null && b.size > 3 && startCodeAt(b, 0)

    private fun startCodeAt(b: ByteArray, i: Int) =
      b[i] == 0.toByte() && b[i + 1] == 0.toByte() && b[i + 2] == 1.toByte()
  }
}
