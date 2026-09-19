// 后端 API 地址：同域部署时留空即可走相对路径；也可在页面里先设置 window.OFFICIAL_API_BASE
const API_BASE = window.OFFICIAL_API_BASE || 'http://127.0.0.1:3000/api/v1'

document.addEventListener('DOMContentLoaded', () => {
  const menuButton = document.getElementById('menuButton')
  const nav = document.getElementById('nav')
  if (menuButton && nav) {
    menuButton.addEventListener('click', () => nav.classList.toggle('open'))
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => nav.classList.remove('open')))
  }

  const year = document.getElementById('year')
  if (year) year.textContent = String(new Date().getFullYear())

  const header = document.getElementById('header')
  const onScroll = () => header?.classList.toggle('scrolled', window.scrollY > 12)
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  // ===== 官网留资表单 =====
  const leadForm = document.getElementById('leadForm')
  const leadSuccess = document.getElementById('leadSuccess')
  const leadSubmit = document.getElementById('leadSubmit')
  if (leadForm && leadSuccess && leadSubmit) {
    const showError = (msg) => {
      let tip = leadForm.querySelector('.lead-error')
      if (!tip) {
        tip = document.createElement('p')
        tip.className = 'lead-error'
        leadForm.insertBefore(tip, leadSubmit)
      }
      tip.textContent = msg
    }

    leadForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const data = Object.fromEntries(new FormData(leadForm).entries())

      if (!/^1[3-9]\d{9}$/.test(data.phone || '')) {
        showError('请输入正确的 11 位手机号')
        leadForm.querySelector('[name="phone"]')?.focus()
        return
      }
      leadForm.querySelector('.lead-error')?.remove()

      leadSubmit.disabled = true
      leadSubmit.textContent = '提交中…'
      try {
        const res = await fetch(`${API_BASE}/leads/public`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: data.phone,
            name: data.name || undefined,
            storeName: data.storeName || undefined,
            storeScale: data.storeScale || undefined,
            interestedItems: data.interestedItems || undefined,
            website: data.website || undefined
          })
        })
        if (res.status === 429) {
          leadSubmit.disabled = false
          leadSubmit.textContent = '提交，获取合作方案'
          showError('提交过于频繁，请稍后再试或直接拨打 18137222005')
          return
        }
        if (!res.ok) throw new Error('network')
        leadForm.hidden = true
        leadSuccess.hidden = false
      } catch (err) {
        leadSubmit.disabled = false
        leadSubmit.textContent = '提交，获取合作方案'
        if (err instanceof TypeError) {
          showError('网络异常，请稍后重试或直接拨打 18137222005')
        } else if (err?.message === 'network') {
          showError('提交失败，请稍后重试或直接拨打 18137222005')
        } else {
          showError('提交失败，请稍后重试')
        }
      }
    })
  }
})