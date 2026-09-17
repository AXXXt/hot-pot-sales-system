Component({
  properties: {
    image: {
      type: String,
      value: ''
    },
    name: {
      type: String,
      value: ''
    },
    spec: {
      type: String,
      value: ''
    },
    price: {
      type: String,
      value: ''
    },
    stockText: {
      type: String,
      value: ''
    },
    actionText: {
      type: String,
      value: '加入'
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('tap')
    }
  }
})
