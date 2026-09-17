Component({
  properties: {
    items: {
      type: Array,
      value: []
    },
    activeId: {
      type: String,
      value: ''
    }
  },

  methods: {
    onTap(e) {
      this.triggerEvent('change', e.currentTarget.dataset.id)
    }
  }
})
