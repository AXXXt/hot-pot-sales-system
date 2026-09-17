Component({
  properties: {
    categories: { type: Array, value: [] },
    activeCategoryId: { type: String, value: 'all' },
    scrollIntoViewId: { type: String, value: '' }
  },

  methods: {
    onTap(e) {
      this.triggerEvent('change', e.currentTarget.dataset.id)
    }
  }
})
