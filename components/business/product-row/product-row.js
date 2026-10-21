// 食材列表行，独立处理详情跳转和选购动作。
Component({
  properties: {
    productId:  { type: Number, value: 0 },
    name:       { type: String, value: '' },
    brandText:  { type: String, value: '' },
    spec:       { type: String, value: '' },
    price:      { type: String, value: '' },
    priceUnit:  { type: String, value: '' },
    statusText: { type: String, value: '' },
    statusVariant: { type: String, value: 'default' },
    subText:    { type: String, value: '' },
    image:      { type: String, value: '', observer() { this.setData({ imageFailed: false }) } }
  },
  data: {
    imageFailed: false
  },
  methods: {
    onTap() { this.triggerEvent('tap', { productId: this.properties.productId }) },
    onActionTap() { this.triggerEvent('add', { productId: this.properties.productId }) },
    onImageError() { this.setData({ imageFailed: true }) }
  }
})
