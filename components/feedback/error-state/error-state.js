Component({
  properties: {
    title: {
      type: String,
      value: '加载失败'
    },
    desc: {
      type: String,
      value: '请稍后重试。'
    },
    actionText: {
      type: String,
      value: ''
    }
  },

  methods: {
    onActionTap() {
      this.triggerEvent('action')
    }
  }
})
