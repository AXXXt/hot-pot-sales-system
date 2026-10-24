(() => {
  const root = document.getElementById('legalDocument'), legal = window.WDQ_LEGAL
  if (!root || !legal) return
  const type = new URLSearchParams(location.search).get('type') === 'privacy' ? 'privacy' : 'terms'
  const doc = legal.documents[type]
  root.textContent = ''
  const add = (tag, text, className) => {
    const node = document.createElement(tag); node.textContent = text
    if (className) node.className = className
    root.appendChild(node); return node
  }
  document.title = `${doc.title} · 唯哆鲜`
  add('h1', doc.title); add('p', `版本 ${legal.version}`); add('p', legal.notice, 'notice'); add('p', doc.intro)
  for (const section of doc.sections) { add('h2', section.title); for (const paragraph of section.paragraphs) add('p', paragraph) }
  add('a', `联系 ${legal.operator}：${legal.phone}`).setAttribute('href', `tel:${legal.phone}`)
})()
