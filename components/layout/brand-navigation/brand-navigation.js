// 自定义品牌导航只占用安全区域，微信胶囊仍由原生渲染。
Component({
  properties: { back: { type: Boolean, value: false } },
  data: { top: 24, height: 80 },
  lifetimes: {
    attached() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const capsule = wx.getMenuButtonBoundingClientRect()
      const top = info.statusBarHeight || 24
      this.setData({ top, height: Math.max(top + 54, capsule.bottom + 8) })
    }
  },
  methods: {
    goBack() {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) })
    }
  }
})
