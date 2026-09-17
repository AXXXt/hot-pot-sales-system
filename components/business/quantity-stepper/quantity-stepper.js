Component({
  properties: {
    value: {
      type: Number,
      value: 1
    }
  },

  methods: {
    decrement() {
      const next = Math.max(1, this.data.value - 1)
      this.setData({ value: next })
      this.triggerEvent('change', next)
    },
    increment() {
      const next = this.data.value + 1
      this.setData({ value: next })
      this.triggerEvent('change', next)
    }
  }
})
