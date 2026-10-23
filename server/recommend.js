// recommend.js —— 点餐推荐引擎（规则版，数字全部来自 MCP 菜单，可解释）
// 输入：{ people, goal, budget, avoid[] }  输出：3 个方案（主推/省钱/丰盛）

function score(item, goal) {
  switch (goal) {
    case '减脂':   return 1000 - item.kcal / 2 + (item.cat === 'salad' ? 300 : 0) + (item.cat === 'drink' && item.kcal <= 100 ? 150 : 0);
    case '放纵':   return item.kcal / 3 + (item.cat === 'burger' ? 200 : 0) + (item.cat === 'snack' ? 60 : 0);
    case '尝新':   return (item.isNew ? 500 : 0) + item.kcal / 10;
    case '下午茶': return (item.cat === 'snack' ? 300 : 0) + (item.cat === 'drink' ? 250 : 0) + (item.kcal > 400 ? -300 : 0);
    case '带娃':   return (item.tags.includes('鸡肉') ? 150 : 0) + (item.cat === 'snack' && item.kcal < 350 ? 150 : 0) - (item.tags.includes('辣') ? 999 : 0);
    default:       return item.kcal / 10;
  }
}

function pick(menu, goal, avoid, perItemBudget) {
  const bad = new Set(avoid || []);
  return menu
    .filter((m) => !m.tags.some((t) => bad.has(t)) && m.price <= perItemBudget)
    .sort((a, b) => score(b, goal) - score(a, goal));
}

function assemble(menu, n, goal, budget, avoid, style) {
  // 结构：n 份主食（人均1）+ 副食/小食 + 每人饮料；按 style 调整档位
  const per = budget / n;
  const pool = pick(menu, goal, avoid, style === 'save' ? per * 0.5 : per);
  if (pool.length < 3) return null;

  const chosen = new Map(); // id -> item（qty 累加，允许多份）
  const take = (cat, count) => {
    const inCat = pool.filter((i) => i.cat === cat);
    if (!inCat.length) return;
    let idx = 0;
    for (let k = 0; k < count; k++) {
      // 先轮流选不同单品保证多样性，选穿圈了再回头加份
      const it = inCat[idx % inCat.length];
      idx++;
      if (chosen.has(it.id)) chosen.get(it.id).qty++;
      else chosen.set(it.id, { ...it, qty: 1 });
    }
  };
  const mains = goal === '减脂' ? Math.max(1, Math.ceil(n / 2)) : n; // 减脂时主食按人头一半
  take('burger', style === 'rich' ? Math.min(n, 3) : mains);
  take('salad', goal === '减脂' ? Math.max(1, Math.floor(n / 2)) : 0);
  take('snack', style === 'rich' ? Math.max(1, n - 1) : Math.max(1, Math.floor(n / 2)));
  take('drink', n);
  if (style === 'rich') take('snack', 1);

  const plan = [...chosen.values()];

  let total = plan.reduce((s, i) => s + i.price * i.qty, 0);
  // 组合优惠：任意堡+薯条+饮料 视作套餐，整套省 6 元
  const hasCombo = plan.some((i) => i.cat === 'burger') && plan.some((i) => i.id.startsWith('fries')) && plan.some((i) => i.cat === 'drink');
  const discount = hasCombo ? 6 : 0;
  total = Math.round((total - discount) * 10) / 10;
  const kcal = plan.reduce((s, i) => s + i.kcal * i.qty, 0);

  if (budget && total > budget) return null;

  const top = plan.filter((i) => i.cat === 'burger' || i.cat === 'salad')[0] || plan[0];
  const reason = {
    '减脂': `主推${top.name}（${top.kcal} kcal），搭配零卡/低卡饮品，整单人均约 ${Math.round(kcal / n)} kcal，比巨无霸套餐少约 ${Math.max(0, 545 + 330 + 180 - Math.round(kcal / n))} kcal`,
    '放纵': `以${top.name}（${top.kcal} kcal）打底，配足小食，人均约 ${Math.round(kcal / n)} kcal，今天不设限`,
    '尝新': `${plan.filter((i) => i.isNew).map((i) => i.name).join('、') || top.name} 是当季新品，先替你试过毒`,
    '下午茶': `小食 + 咖啡的轻组合，人均 ${Math.round(kcal / n)} kcal，扛住下午不犯困`,
    '带娃': `避开辣味，${top.name} + 小食 + 牛奶，小朋友能吃全`,
  }[goal] || `按你的口味和预算凑的，人均 ¥${Math.round(total / n)}`;

  return { items: plan, total, discount, kcal, perPerson: Math.round((total / n) * 10) / 10, kcalPerPerson: Math.round(kcal / n), reason };
}

function recommend(menu, { people = 1, goal = '放纵', budget = 0, avoid = [] } = {}) {
  const n = Math.max(1, Math.min(20, parseInt(people, 10) || 1));
  const plans = [];
  const styles = ['normal', 'save', 'rich'];
  for (const style of styles) {
    const p = assemble(menu, n, goal, budget || 99999, avoid, style);
    if (p) plans.push({ style, label: { normal: '主推', save: '省钱版', rich: '丰盛版' }[style], ...p });
  }
  // 预算太紧时兜底：只出省钱版
  if (!plans.length) {
    const p = assemble(menu, n, goal, 99999, avoid, 'save');
    if (p) plans.push({ style: 'save', label: '量力而行版', ...p, note: '预算偏紧，先按这个来' });
  }
  return plans;
}

module.exports = { recommend };
