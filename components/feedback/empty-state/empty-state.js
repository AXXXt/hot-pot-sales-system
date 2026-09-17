Component({
  properties: {
    icon: {
      type: String,
      value: '◌'
    },
    title: {
      type: String,
      value: '暂无数据'
    },
    desc: {
      type: String,
      value: '当前页面没有可展示内容。'
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
