package com.ventic.app

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.ParsableBitArray
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.mkv.MatroskaExtractor
import androidx.media3.extractor.text.DefaultSubtitleParserFactory
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
 * the same codec. Every other track passes straight through, bar two Matroska
 * repairs further down (`SkipsCompressed`, `Counted`) that live here because
 * this is the one factory both routes read through.
 */
@androidx.annotation.OptIn(UnstableApi::class)
class Mpeg4Headers(private val inner: ExtractorsFactory) : ExtractorsFactory {
  override fun createExtractors(): Array<Extractor> = inner.createExtractors().map(::wrap).toTypedArray()

  override fun createExtractors(uri: Uri, responseHeaders: Map<String, List<String>>): Array<Extractor> =
    inner.createExtractors(uri, responseHeaders).map(::wrap).toTypedArray()

  // What DefaultExtractorsFactory builds its own Matroska reader with, so the one
  // swapped in below reads subtitles exactly as that one would have.
  private var subtitles: SubtitleParser.Factory = DefaultSubtitleParserFactory()
  private var transcoding = true

  private fun wrap(extractor: Extractor): Extractor = Wrapped(
    if (extractor is MatroskaExtractor) {
      SkipsCompressed(subtitles, if (transcoding) 0 else MatroskaExtractor.FLAG_EMIT_RAW_SUBTITLE_DATA)
    } else {
      extractor
    },
  )

  // DefaultMediaSourceFactory sets up subtitle parsing through these, and the
  // interface's own defaults would quietly do nothing with it.
  override fun setSubtitleParserFactory(factory: SubtitleParser.Factory) =
    apply {
      subtitles = factory
      inner.setSubtitleParserFactory(factory)
    }

  @Deprecated("Forwarded for as long as DefaultMediaSourceFactory still calls it")
  @Suppress("DEPRECATION")
  override fun experimentalSetTextTrackTranscodingEnabled(enabled: Boolean) =
    apply {
      transcoding = enabled
      inner.experimentalSetTextTrackTranscodingEnabled(enabled)
    }

  override fun experimentalSetCodecsToParseWithinGopSampleDependencies(codecs: Int) =
    apply { inner.experimentalSetCodecsToParseWithinGopSampleDependencies(codecs) }

  private class Wrapped(private val inner: Extractor) : Extractor {
    override fun sniff(input: ExtractorInput) = inner.sniff(input)

    override fun getSniffFailureDetails() = inner.sniffFailureDetails

    override fun init(output: ExtractorOutput) {
      val tracks = HashMap<Int, TrackOutput>()
      inner.init(object : ExtractorOutput {
        override fun track(id: Int, type: Int) = tracks.getOrPut(id) {
          output.track(id, type).let {
            when (type) {
              C.TRACK_TYPE_VIDEO -> Held(it)
              C.TRACK_TYPE_AUDIO -> Counted(it)
              else -> it
            }
          }
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

  /**
   * Gives an AAC track laid out by a program config element the channel count
   * media3 leaves at 0.
   *
   * FFmpeg's encoder writes 7.1 that way — channelConfiguration 0, and the
   * layout in-band — and media3 (1.8.0) reads no PCE, so the track reaches the
   * player as 0 channels. The decoder doesn't mind (it reads the PCE itself and
   * comes out with 8), but the track selector ranks audio by channel count when
   * no track is flagged default, so a film's 7.1 soundtrack lost to its own
   * stereo commentary: The Descent, cast to the TV, played the director talking
   * over it. mpv takes the first track and never noticed.
   */
  private class Counted(private val out: TrackOutput) : TrackOutput by out {
    override fun format(format: Format) {
      val pce = format.initializationData.firstOrNull()
        ?.takeIf { format.sampleMimeType == MimeTypes.AUDIO_AAC && format.channelCount <= 0 }
      val channels = pce?.let(::pceChannels) ?: 0
      out.format(if (channels > 0) format.buildUpon().setChannelCount(channels).build() else format)
    }

    // A default method on the interface, which `by` doesn't forward: left out,
    // every audio track's duration would quietly go nowhere.
    override fun durationUs(durationUs: Long) = out.durationUs(durationUs)
  }

  /**
   * A Matroska reader that leaves out a track it can't decompress, rather than
   * the whole film.
   *
   * mkvmerge zlib-compresses PGS and VobSub subtitles by default, and media3
   * (1.8.0) reads header stripping and nothing else: one such track throws
   * `ContentCompAlgo 0 not supported` before a single frame is decoded, and the
   * film fails as a container that "could not be read". Measured on a BluRay
   * x265 release carrying eight PGS tracks, which mpv plays without a word —
   * so it played on the laptop and failed when cast to the TV. Nothing is lost
   * by leaving them out: a bitmap subtitle has no text, and text is all the
   * page draws (`onCues` in Player.kt).
   *
   * ponytail: any compressed track, not only a subtitle. A zlib picture or sound
   * has never turned up (FFmpeg's muxer never compresses, mkvmerge only
   * subtitles), and would play without it rather than fail.
   */
  private class SkipsCompressed(subtitles: SubtitleParser.Factory, flags: Int) : MatroskaExtractor(subtitles, flags) {
    private var compressed = false

    override fun integerElement(id: Int, value: Long) {
      // ContentCompAlgo; 3 is header stripping, the one media3 reads.
      if (id == 0x4254 && value != 3L) compressed = true else super.integerElement(id, value)
    }

    override fun endMasterElement(id: Int) {
      // The end of a TrackEntry, where its codec is settled whatever order the
      // elements came in. A codec media3 doesn't know is a track it leaves out.
      if (id == 0xAE && compressed) {
        compressed = false
        getCurrentTrack(id).codecId = "ventic/compressed"
      }
      super.endMasterElement(id)
    }
  }
}

/**
 * The channels an AAC AudioSpecificConfig's program config element lays out
 * (ISO 14496-3, 1.6.2.1 and 4.4.1.1), or 0 where it has none to read.
 */
private fun pceChannels(asc: ByteArray): Int {
  val b = ParsableBitArray(asc)
  return try {
    val objectType = b.readBits(5)
    if (b.readBits(4) == 0xF) b.skipBits(24) // a sampling rate spelled out
    // Main, LC, SSR or LTP, whose config this layout is part of — and
    // channelConfiguration 0, the one that says a PCE follows.
    if (objectType !in 1..4 || b.readBits(4) != 0) return 0
    b.skipBits(1) // frameLengthFlag
    if (b.readBit()) b.skipBits(14) // dependsOnCoreCoder, and the coder's delay
    b.skipBits(1 + 4 + 2 + 4) // extensionFlag; the PCE's own tag, object type and rate
    val elements = b.readBits(4) + b.readBits(4) + b.readBits(4) // front, side, back
    var channels = b.readBits(2) // LFE
    b.skipBits(3 + 4) // data and coupling elements
    if (b.readBit()) b.skipBits(4) // mono mixdown
    if (b.readBit()) b.skipBits(4) // stereo mixdown
    if (b.readBit()) b.skipBits(3) // matrix mixdown
    repeat(elements) {
      channels += if (b.readBit()) 2 else 1 // a channel pair, or one channel
      b.skipBits(4)
    }
    channels
  } catch (_: IllegalStateException) {
    0 // shorter than it says it is
  }
}
