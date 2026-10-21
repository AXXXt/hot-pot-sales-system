// 受控数量组件，越界和禁用状态不会触发变更。
Component({
  properties: {
    value: { type: Number, value: 1 },
    min: { type: Number, value: 1 },
    max: { type: Number, value: 999999 },
    disabled: { type: Boolean, value: false }
  },
  methods: {
    decrement() { this.changeBy(-1) },
    increment() { this.changeBy(1) },
    changeBy(delta) {
      if (this.data.disabled) return
      const next = Number(this.data.value) + delta
      if (next < this.data.min || next > this.data.max) return
      this.triggerEvent('change', next)
    }
  }
})
