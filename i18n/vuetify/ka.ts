// ქართული — Vuetify ships no locale for this language, so these are ours.
// Hand-written: `bun run i18n` imports this file and never rewrites it.
// Partial on purpose — see README.md.
export default {
  badge: 'სამკერდე ნიშანი',
  open: 'გახსნა',
  close: 'დახურვა',
  dismiss: 'დამალვა',
  loading: 'იტვირთება…',
  noDataText: 'მონაცემები არ არის',
  dataIterator: {
    noResultsText: 'შესაბამისი ჩანაწერი ვერ მოიძებნა',
    loadingText: 'ელემენტები იტვირთება…',
  },
  dataTable: {
    itemsPerPageText: 'სტრიქონი გვერდზე:',
    sortBy: 'დალაგება',
    ariaLabel: {
      sortDescending: 'დალაგებულია კლებადობით.',
      sortAscending: 'დალაგებულია ზრდადობით.',
      sortNone: 'არ არის დალაგებული.',
      activateNone: 'გაააქტიურეთ დალაგების მოსახსნელად.',
      activateDescending: 'გაააქტიურეთ კლებადობით დასალაგებლად.',
      activateAscending: 'გაააქტიურეთ ზრდადობით დასალაგებლად.',
    },
  },
  input: {
    clear: '{0}-ის გასუფთავება',
    prependAction: '{0} წინ დამატებული ქმედება',
    appendAction: '{0} ბოლოს დამატებული ქმედება',
  },
  colorPicker: {
    ariaLabel: {
      hueSlider: 'ტონი',
      alphaSlider: 'ალფა',
    },
  },
}
