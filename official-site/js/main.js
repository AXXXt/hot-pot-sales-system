// 后端 API 地址：同域部署时留空即可走相对路径；也可在页面里先设置 window.OFFICIAL_API_BASE
const API_BASE = window.OFFICIAL_API_BASE || (location.hostname === 'weiduoxian.cn' || location.hostname === 'www.weiduoxian.cn' ? '/api/v1' : 'http://127.0.0.1:3000/api/v1')
// PC 采购台地址：上线前设置 window.OFFICIAL_CLIENT_LOGIN（或在部署脚本里替换）即可全站生效
const CLIENT_LOGIN = window.OFFICIAL_CLIENT_LOGIN || (location.hostname === 'weiduoxian.cn' || location.hostname === 'www.weiduoxian.cn' ? 'https://app.weiduoxian.cn/login' : '')

document.addEventListener('DOMContentLoaded', () => {
  // ===== 采购台入口地址（可配置） =====
  if (CLIENT_LOGIN) {
    document.querySelectorAll('[data-client-link]').forEach((el) => el.setAttribute('href', CLIENT_LOGIN))
  }

  // ===== 移动端导航 =====
  const menuButton = document.getElementById('menuButton')
  const nav = document.getElementById('nav')
  if (menuButton && nav) {
    menuButton.addEventListener('click', () => {
      const open = nav.classList.toggle('open')
      menuButton.setAttribute('aria-expanded', open ? 'true' : 'false')
      menuButton.textContent = open ? '关闭' : '菜单'
    })
    nav.querySelectorAll('a').forEach((link) =>
      link.addEventListener('click', () => {
        nav.classList.remove('open')
        menuButton.setAttribute('aria-expanded', 'false')
        menuButton.textContent = '菜单'
      })
    )
  }

  const year = document.getElementById('year')
  if (year) year.textContent = String(new Date().getFullYear())

  // ===== 顶部导航滚动状态 =====
  const header = document.getElementById('header')
  const onHeaderScroll = () => header?.classList.toggle('scrolled', window.scrollY > 12)
  window.addEventListener('scroll', onHeaderScroll, { passive: true })
  onHeaderScroll()

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ===== 滚动显现 =====
  const revealItems = document.querySelectorAll('.reveal')
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealItems.forEach((el) => el.classList.add('is-visible'))
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    )
    revealItems.forEach((el) => observer.observe(el))
  }

  // ===== 采购流程时间线进度 =====
  const workflow = document.getElementById('workflowList')
  if (workflow) {
    let ticking = false
    const paint = () => {
      ticking = false
      const rect = workflow.getBoundingClientRect()
      const anchor = window.innerHeight * 0.82
      const ratio = rect.height > 0 ? (anchor - rect.top) / rect.height : 0
      const progress = Math.min(1, Math.max(0, ratio))
      workflow.style.setProperty('--progress', progress.toFixed(3))
    }
    const request = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(paint)
    }
    if (reduceMotion) {
      workflow.style.setProperty('--progress', '1')
    } else {
      window.addEventListener('scroll', request, { passive: true })
      window.addEventListener('resize', request)
      paint()
    }
  }

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
