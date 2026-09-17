Component({
  properties: {
    title: {
      type: String,
      value: ''
    },
    subtitle: {
      type: String,
      value: ''
    },
    showBack: {
      type: Boolean,
      value: true
    }
  },

  methods: {
    onBack() {
      wx.navigateBack({ delta: 1 })
    }
  }
})
