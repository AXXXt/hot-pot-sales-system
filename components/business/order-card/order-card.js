Component({
  properties: {
    orderNo: { type: String, value: '' },
    timeText: { type: String, value: '' },
    statusText: { type: String, value: '' },
    statusVariant: { type: String, value: 'default' },
    summaryText: { type: String, value: '' },
    deliveryText: { type: String, value: '' },
    amountText: { type: String, value: '' },
    images: { type: Array, value: [] },
    actions: { type: Array, value: [] }
  },

  methods: {
    onTap() {
      this.triggerEvent('tap')
    },
    onActionTap(e) {
      e.stopPropagation()
      this.triggerEvent('action', { id: e.currentTarget.dataset.id })
    }
  }
})
