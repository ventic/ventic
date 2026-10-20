import type { DirectiveBinding, VNode } from 'vue'
import { Tooltip } from 'vuetify/directives'

/**
 * `v-tooltip`, mounted only once something comes to read it.
 *
 * Vuetify's directive mounts a whole VTooltip for every element it is on, at
 * mount and again on every re-render of the component around it, and each time
 * walks that component's tree to find where it sits — so a row of cards with a
 * tooltip each is quadratic. Measured on the test TV: nearly a second of a
 * film's page opening was 47 of these (two per cast card), and the 800-cell
 * ratings grid took six. Nobody reads a tooltip until a mouse rests on the
 * element or keyboard focus lands on it, so that is when this mounts the real
 * one. A television never does: it hides every tooltip (layers.css), and no
 * pointer passes over anything there. Nor does a finger — a tap is not a hover.
 *
 * vuetify-nuxt-module is told to leave `Tooltip` alone (`ignoreDirectives` in
 * nuxt.config), which is what makes templates resolve this one instead.
 */
interface Held { binding: DirectiveBinding, vnode: VNode, live: boolean, wake: (e: Event) => void }

const held = new WeakMap<HTMLElement, Held>()

export default defineNuxtPlugin(nuxtApp => {
  const tv = isTv() === true

  nuxtApp.vueApp.directive('tooltip', {
    mounted(el: HTMLElement, binding, vnode) {
      if (tv)
        return
      const h: Held = {
        binding,
        vnode,
        live: false,
        wake(e) {
          if (e.type === 'pointerenter' && (e as PointerEvent).pointerType !== 'mouse')
            return
          el.removeEventListener('pointerenter', h.wake)
          el.removeEventListener('focusin', h.wake)
          h.live = true
          Tooltip.mounted!(el, h.binding, h.vnode, null as unknown as VNode)
          // Its own listeners go on a tick later, after the mouse or the focus
          // that woke it has already arrived — so that is handed on again.
          requestAnimationFrame(() => {
            if (el.matches(':hover'))
              el.dispatchEvent(new MouseEvent('mouseenter'))
            else if (el.matches(':focus-visible'))
              el.dispatchEvent(new FocusEvent('focus'))
          })
        },
      }
      el.addEventListener('pointerenter', h.wake)
      el.addEventListener('focusin', h.wake)
      held.set(el, h)
    },
    updated(el: HTMLElement, binding, vnode) {
      const h = held.get(el)
      if (!h)
        return
      h.binding = binding
      h.vnode = vnode
      if (h.live)
        Tooltip.updated!(el, binding, vnode, null as unknown as VNode)
    },
    unmounted(el: HTMLElement, binding, vnode) {
      const h = held.get(el)
      if (h?.live) {
        Tooltip.unmounted!(el, binding, vnode, null as unknown as VNode)
      }
      else if (h) {
        el.removeEventListener('pointerenter', h.wake)
        el.removeEventListener('focusin', h.wake)
      }
      held.delete(el)
    },
  })
})
