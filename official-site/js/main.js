// 后端 API 地址：同域部署时留空即可走相对路径；也可在页面里先设置 window.OFFICIAL_API_BASE
const API_BASE = window.OFFICIAL_API_BASE || (location.hostname === 'weiduoxian.cn' || location.hostname === 'www.weiduoxian.cn' ? '/api/v1' : 'http://127.0.0.1:3000/api/v1')
// PC 采购台地址：上线前设置 window.OFFICIAL_CLIENT_LOGIN（或在部署脚本里替换）即可全站生效
const CLIENT_LOGIN = window.OFFICIAL_CLIENT_LOGIN || (location.hostname === 'weiduoxian.cn' || location.hostname === 'www.weiduoxian.cn' ? 'https://app.weiduoxian.cn/login' : ['127.0.0.1', 'localhost'].includes(location.hostname) ? 'http://127.0.0.1:5174/login' : '')

document.addEventListener('DOMContentLoaded', () => {
  // ===== 采购台入口地址（可配置） =====
  if (CLIENT_LOGIN) {
    document.querySelectorAll('[data-client-link]').forEach((el) => el.setAttribute('href', CLIENT_LOGIN))
    const catalogUrl = new URL('/category', CLIENT_LOGIN).href
    document.querySelectorAll('[data-catalog-link]').forEach((el) => el.setAttribute('href', catalogUrl))
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
    let submissionId = '', submissionFingerprint = ''
    const newSubmissionId = () => {
      if (typeof window.crypto?.randomUUID === 'function') return window.crypto.randomUUID()
      if (typeof window.crypto?.getRandomValues !== 'function') return ''
      const bytes = new Uint8Array(16); window.crypto.getRandomValues(bytes)
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
      const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
    const showError = (msg) => {
      let tip = leadForm.querySelector('.lead-error')
      if (!tip) {
        tip = document.createElement('p')
        tip.className = 'lead-error'
        tip.setAttribute('role', 'alert')
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
      if (data.consent !== 'on') {
        showError('请先阅读并同意用户协议和隐私政策')
        leadForm.querySelector('[name="consent"]')?.focus()
        return
      }
      if (!window.WDQ_LEGAL?.version) { showError('协议加载失败，请刷新页面后重试'); return }
      const fingerprint = JSON.stringify([data.phone, data.name || '', data.storeName || '', data.storeScale || '', data.interestedItems || '', window.WDQ_LEGAL.version])
      if (!submissionId || submissionFingerprint !== fingerprint) { submissionId = newSubmissionId(); submissionFingerprint = fingerprint }
      if (!submissionId) { showError('当前浏览器无法安全提交，请更换浏览器或电话联系'); return }
      leadForm.querySelector('.lead-error')?.remove()

      leadSubmit.disabled = true
      leadSubmit.textContent = '提交中…'
      try {
        const res = await fetch(`${API_BASE}/leads/public`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: data.phone,
            requestId: submissionId,
            consentAccepted: true,
            consentVersion: window.WDQ_LEGAL.version,
            consentChannel: 'official_site',
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
          showError('提交过于频繁，请稍后再试或直接拨打 13937802005')
          return
        }
        if (!res.ok) {
          const payload = await res.json().catch(() => null)
          if (payload?.errorCode === 'LEGAL_VERSION_CHANGED') throw new Error('legal-version')
          if (payload?.errorCode === 'LEAD_IDEMPOTENCY_CONFLICT') throw new Error('submission-conflict')
          throw new Error('network')
        }
        leadForm.hidden = true
        leadSuccess.hidden = false
      } catch (err) {
        leadSubmit.disabled = false
        leadSubmit.textContent = '提交，获取合作方案'
        if (err?.message === 'legal-version') {
          showError('协议版本已更新，请刷新页面，重新阅读并同意后提交')
        } else if (err?.message === 'submission-conflict') {
          showError('本次提交内容已变化，请刷新页面后重新提交')
        } else if (err instanceof TypeError) {
          showError('网络异常，请稍后重试或直接拨打 13937802005')
        } else if (err?.message === 'network') {
          showError('提交失败，请稍后重试或直接拨打 13937802005')
        } else {
          showError('提交失败，请稍后重试')
        }
      }
    })
  }
})
