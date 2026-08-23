// қазақ тілі — Vuetify ships no locale for this language, so these are ours.
// Hand-written: `bun run i18n` imports this file and never rewrites it.
// Partial on purpose — see README.md.
export default {
  badge: 'Белгіше',
  open: 'Ашу',
  close: 'Жабу',
  dismiss: 'Елемеу',
  loading: 'Жүктелуде…',
  noDataText: 'Деректер жоқ',
  dataIterator: {
    noResultsText: 'Сәйкес жазба табылмады',
    loadingText: 'Элементтер жүктелуде…',
  },
  dataTable: {
    itemsPerPageText: 'Беттегі жолдар саны:',
    sortBy: 'Сұрыптау',
    ariaLabel: {
      sortDescending: 'Кемуі бойынша сұрыпталған.',
      sortAscending: 'Өсуі бойынша сұрыпталған.',
      sortNone: 'Сұрыпталмаған.',
      activateNone: 'Сұрыптауды алып тастау үшін іске қосыңыз.',
      activateDescending: 'Кемуі бойынша сұрыптау үшін іске қосыңыз.',
      activateAscending: 'Өсуі бойынша сұрыптау үшін іске қосыңыз.',
    },
  },
  input: {
    clear: '{0} тазалау',
    prependAction: '{0} басындағы әрекет',
    appendAction: '{0} соңындағы әрекет',
  },
  colorPicker: {
    ariaLabel: {
      hueSlider: 'Реңк',
      alphaSlider: 'Альфа',
    },
  },
}
