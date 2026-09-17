Component({
  properties: {
    items: { type: Array, value: [] },
    activeId: { type: String, value: '' },
    scrollable: { type: Boolean, value: false }
  },

  methods: {
    onTap(e) {
      this.triggerEvent('change', e.currentTarget.dataset.id)
    }
  }
})
