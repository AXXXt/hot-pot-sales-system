Component({
  properties: {
    placeholder: {
      type: String,
      value: '搜索商品'
    },
    value: {
      type: String,
      value: ''
    }
  },

  methods: {
    onInput(e) {
      this.triggerEvent('input', e.detail.value)
    }
  }
})
