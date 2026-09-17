function formatMoney(value) {
  const num = Number(value || 0)
  if (Number.isNaN(num)) return '¥0.00'
  return `¥${num.toFixed(2)}`
}

function maskPhone(phone) {
  if (!phone) return ''
  return String(phone).replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

module.exports = {
  formatMoney,
  maskPhone
}
