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
    image:      { type: String, value: '' }
  },
  data: {
    imageLoaded: false
  },
  methods: {
    onTap() { this.triggerEvent('tap', { productId: this.properties.productId }) },
    onActionTap() { this.triggerEvent('add', { productId: this.properties.productId }) },
    onImageError() { this.setData({ imageLoaded: false }) }
  }
})
