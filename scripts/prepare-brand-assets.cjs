// Optimize the approved artwork without redrawing or retouching the trademark.
const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require(process.env.SHARP_MODULE || 'sharp')
const root = path.resolve(__dirname, '..')
const { h } = require(path.join(root, 'web-customer/node_modules/vue'))
const { renderToString } = require(path.join(root, 'web-customer/node_modules/@vue/server-renderer'))
const icons = require(path.join(root, 'web-customer/node_modules/@element-plus/icons-vue'))
const source = process.argv[2]
if (!source) throw new Error('Pass the approved design assets directory')
async function save(input, output, width) {
  const target = path.join(root, output)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await sharp(path.join(source, input)).resize({ width, withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toFile(target)
}
async function main() {
  for (const folder of ['assets/brand', 'web-customer/public/brand', 'official-site/assets/brand', 'admin-web/public/brand']) {
    await save('brand-original.jpg', `${folder}/logo.jpg`, 473)
  }
  await save('editorial-food.png', 'official-site/assets/brand/hero.jpg', 1536)
  for (const name of ['greens', 'broth']) await save(`${name}.png`, `official-site/assets/brand/${name}.jpg`, 800)
  await save('editorial-food.png', 'assets/brand/editorial.jpg', 750)
  const iconJobs = [['ArrowLeft', 'assets/brand/back.png', '#222625'], ['Search', 'assets/brand/search.png', '#666e68'], ['Document', 'assets/brand/orders.png', '#222625'], ['ShoppingCart', 'assets/brand/cart-white.png', '#ffffff'], ['ShoppingCart', 'assets/brand/cart.png', '#222625']]
  for (const [name, filename] of [['House', 'home'], ['Grid', 'category'], ['Document', 'orders'], ['User', 'profile']]) {
    iconJobs.push([name, `assets/tabbar/${filename}.png`, '#737975'], [name, `assets/tabbar/${filename}-active.png`, '#c4461b'])
  }
  for (const [name, filename, color] of iconJobs) {
    const svg = (await renderToString(h(icons[name]))).replace('<svg ', '<svg width="48" height="48" ').replaceAll('currentColor', color)
    await sharp(Buffer.from(svg)).png().toFile(path.join(root, filename))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
