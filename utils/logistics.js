// 客户界面的配送方式文案，兼容历史中文值与尚未识别的新类型。
function logisticsText(value) {
  return { tricycle: '三轮车（同城）', 'cold-chain': '冷链配送', regular: '普货物流' }[value] || value || ''
}

module.exports = { logisticsText }
