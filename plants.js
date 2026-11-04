/* 植物图鉴与小动物、道具、装饰数据
   形状 shape: seed种 | daisy雏菊 | rose玫瑰 | sunflower向日葵 | lavender穗 |
   tulip郁金香 | bell铃兰 | blossom花树 | hydrangea绣球 | cluster满天星 |
   round芍药 | iris鸢尾 | lily百合 | orchid兰花 | dandelion蒲公英 |
   cactus仙人掌 | succulent多肉 | bamboo竹 | vine藤蔓 | clover四叶草 |
   sensitive含羞草 | pitcher捕虫草 | grass香草
   c1 主色 c2 辅色  cost 花露价格  cat 分类  lang: [简介, 花语文案]
*/
const PLANT_CATALOG = [
  // —— 基础免费 ——
  { id: "sprout", name: "青芽", shape: "seed", c1: "#7cb342", c2: "#aed581", cost: 0, cat: "草", lang: ["最朴素的开始，什么都还没发生，什么都有可能。", "每一座花园，都从一株不起眼的青芽开始。"] },
  { id: "daisy", name: "雏菊", shape: "daisy", c1: "#ffffff", c2: "#f7d354", cost: 0, cat: "花", lang: ["小小的花，开在路边也不觉得委屈，风一吹就摇摇晃晃地笑。", "雏菊的花语是天真与深藏心底的爱——喜欢得不敢声张，就把喜欢开成一整个春天。"] },
  { id: "sunflower", name: "向日葵", shape: "sunflower", c1: "#f4b429", c2: "#8d6e63", cost: 0, cat: "花", lang: ["永远面朝太阳的方向站得笔直，是田野里最认真的存在。", "向日葵的花语是沉默的爱与信念——不必被看见，我自向阳而生。"] },
  { id: "clover", name: "四叶草", shape: "clover", c1: "#66bb6a", c2: "#e91e63", cost: 0, cat: "草", lang: ["传说十万株三叶草里，才藏着一株四叶。", "四叶草的花语是幸运——不是天上掉下来的运气，是坚持走过十万分之一才配得到的礼物。"] },

  // —— 百花齐放 ——
  { id: "jasmine", name: "茉莉", shape: "bush", c1: "#ffffff", c2: "#e8f5e9", cost: 15, cat: "花", lang: ["夏夜里悄悄开的花，香气比花本身更早被记住。", "茉莉的花语是纯洁与忠贞——有一种喜欢很轻，轻得只剩香气，却怎么也散不掉。"] },
  { id: "rose", name: "玫瑰", shape: "rose", c1: "#e8654f", c2: "#ef9a9a", cost: 18, cat: "花", lang: ["带刺，是为了保护自己心里最软的部分。", "玫瑰的花语是热烈的爱与勇气——爱这件事，本来就值得孤注一掷。"] },
  { id: "lavender", name: "薰衣草", shape: "lavender", c1: "#9575cd", c2: "#b39ddb", cost: 22, cat: "花", lang: ["成片成片地开，把整座山染成安睡的颜色。", "薰衣草的花语是等待爱情——等待不着急，因为我相信你来的时候，风都是香的。"] },
  { id: "gardenia", name: "栀子", shape: "bush", c1: "#fffde7", c2: "#c5e1a5", cost: 26, cat: "花", lang: ["初夏的雨后，白得发亮，香得理直气壮。", "栀子的花语是永恒的爱与约定——有些人只出现一个夏天，却香了一辈子。"] },
  { id: "tulip", name: "郁金香", shape: "tulip", c1: "#ef5350", c2: "#ffcdd2", cost: 26, cat: "花", lang: ["杯子的形状，像随时准备盛住春天的第一场雨。", "郁金香的花语是体贴与博爱——温柔不需要理由，就像花开不需要观众。"] },
  { id: "sakura", name: "樱花", shape: "blossom", c1: "#f8a5c2", c2: "#fce4ec", cost: 35, cat: "花", lang: ["开得倾尽全力，落得干干净净。", "樱花的花语是生命之美与瞬逝——正因为留不住，盛开的那一周才值得全世界抬头。"] },
  { id: "lilyofthevalley", name: "铃兰", shape: "bell", c1: "#ffffff", c2: "#e8f5e9", cost: 30, cat: "花", lang: ["一串串小白铃铛挂在茎上，风过时仿佛有极轻的响声。", "铃兰的花语是幸福归来——所有认真生活的人，幸福都会绕一圈回到你身边。"] },
  { id: "hyacinth", name: "风信子", shape: "lavender", c1: "#64b5f6", c2: "#bbdefb", cost: 32, cat: "花", lang: ["先开花后长叶，像先许愿再努力。", "风信子的花语是重生的喜悦——只要根还在，枯过一次又算什么呢。"] },
  { id: "babysbreath", name: "满天星", shape: "cluster", c1: "#ffffff", c2: "#f5f5f5", cost: 28, cat: "花", lang: ["单独一朵不起眼，聚在一起就是整片星空。", "满天星的花语是甘做配角的爱——我不需要成为你的玫瑰，我只想待在你的花束里。"] },
  { id: "forgetmenot", name: "勿忘我", shape: "cluster", c1: "#64b5f6", c2: "#e3f2fd", cost: 30, cat: "花", lang: ["小小的蓝花，名字像一句叮嘱。", "勿忘我的花语是永恒的记忆——时间可以带走很多东西，带不走被认真记住的瞬间。"] },
  { id: "violet", name: "紫罗兰", shape: "tulip", c1: "#7e57c2", c2: "#d1c4e9", cost: 34, cat: "花", lang: ["开在墙角的阴影里，香气却很倔强。", "紫罗兰的花语是永恒的美与爱——美会旧，爱不会。"] },
  { id: "dandelion", name: "蒲公英", shape: "dandelion", c1: "#ffffff", c2: "#fff9c4", cost: 25, cat: "花", lang: ["一吹就散，散到哪里，哪里就是家。", "蒲公英的花语是自由与无法停留的爱——留不住的，就祝它风越来越大。"] },
  { id: "osmanthus", name: "桂花", shape: "bush", c1: "#fbc02d", c2: "#fff59d", cost: 40, cat: "花", lang: ["米粒大的花，却能把整条街的秋天都熏甜。", "桂花的花语是收获与荣光——真正的成果往往不起眼，但闻得出来。"] },
  { id: "camellia", name: "山茶", shape: "rose", c1: "#e53935", c2: "#ffcdd2", cost: 38, cat: "花", lang: ["冬天开的花，凋谢时整朵整朵地落，从不零落成泥。", "山茶的花语是理想的爱——爱就爱得完整，谢也谢得体面。"] },
  { id: "peony", name: "芍药", shape: "round", c1: "#f06292", c2: "#f8bbd0", cost: 45, cat: "花", lang: ["层层叠叠地开，像把整个初夏的富贵的开在一根茎上。", "芍药的花语是情有独钟——开再多花，也只钟情于一次盛放。"] },
  { id: "azalea", name: "杜鹃", shape: "round", c1: "#e57373", c2: "#ffccbc", cost: 36, cat: "花", lang: ["漫山遍野地红，热闹得像一封群发的情书。", "杜鹃的花语是思乡与爱的快乐——走得再远，春天还是会想起那座山。"] },
  { id: "hibiscus", name: "木槿", shape: "round", c1: "#ba68c8", c2: "#e1bee7", cost: 38, cat: "花", lang: ["朝开暮落，第二天照样重新开。", "木槿的花语是温柔的坚持——每一次凋谢都是下一次盛开的练习。"] },
  { id: "redspider", name: "彼岸花", shape: "lavender", c1: "#d32f2f", c2: "#ff8a80", cost: 50, cat: "花", lang: ["花开不见叶，叶生不见花，花叶永不相见。", "彼岸花的花语是回忆与生死之隔——有些人只能怀念，就像有些花注定自己开自己落。"] },
  { id: "lisianthus", name: "洋桔梗", shape: "tulip", c1: "#90caf9", c2: "#e3f2fd", cost: 42, cat: "花", lang: ["像玫瑰的温柔版，卷边花瓣带着一点点犹豫。", "洋桔梗的花语是不变的爱——世界变来变去，我这里始终如一。"] },
  { id: "hydrangea", name: "绣球", shape: "hydrangea", c1: "#7986cb", c2: "#c5cae9", cost: 48, cat: "花", lang: ["一大团一大团地开，颜色随土壤心情变换。", "绣球的花语是希望与团圆——攒了整整一个春天的力气，只为了团团圆圆地开一次。"] },
  { id: "pansy", name: "三色堇", shape: "daisy", c1: "#7b1fa2", c2: "#ffeb3b", cost: 30, cat: "花", lang: ["花瓣像一张沉思的小脸。", "三色堇的花语是快乐与沉思——想一也没关系，想完记得笑。"] },
  { id: "carnation", name: "康乃馨", shape: "round", c1: "#f48fb1", c2: "#fce4ec", cost: 32, cat: "花", lang: ["花瓣边缘细细的锯齿，像母亲缝补的针脚。", "康乃馨的花语是母爱与温馨——有一种爱不求回报，只求你按时吃饭。"] },
  { id: "iris", name: "鸢尾", shape: "iris", c1: "#5c6bc0", c2: "#c5cae9", cost: 40, cat: "花", lang: ["花瓣展开的样子，像一封蓝色的信。", "鸢尾的花语是好消息与信仰——彩虹的使者说：再等等，好消息在路上。"] },
  { id: "lily", name: "百合", shape: "lily", c1: "#ffffff", c2: "#fff9c4", cost: 44, cat: "花", lang: ["大大方方地开，香得堂堂正正。", "百合的花语是纯洁与庄严——有些心意的干净程度，值得开成花。"] },
  { id: "orchid", name: "兰花", shape: "orchid", c1: "#f8bbd0", c2: "#a1887f", cost: 55, cat: "花", lang: ["生在幽谷，不为无人而不芳。", "兰花的花语是高洁与典雅——真正的讲究，是不需要观众的讲究。"] },
  { id: "plum", name: "梅花", shape: "blossom", c1: "#f48fb1", c2: "#8d6e63", cost: 52, cat: "花", lang: ["雪还没化，它先开了。", "梅花的花语是坚强与忠贞——凌寒独自开的人，从不问春天几时来。"] },
  { id: "morningglory", name: "牵牛花", shape: "vine", c1: "#64b5f6", c2: "#81d4fa", cost: 28, cat: "花", lang: ["清晨四点就起，攀着篱笆一路向上，是花园里最勤快的闹钟。", "牵牛花的花语是爱慕与勤勉——早起的人，先把太阳等来。"] },

  // —— 草木与趣植 ——
  { id: "mint", name: "薄荷", shape: "grass", c1: "#66bb6a", c2: "#b2dfdb", cost: 16, cat: "草", lang: ["掐一片叶子，指尖凉半天。", "薄荷的花语是美德与重逢——愿我们再次相遇时，都长成了更清爽的人。"] },
  { id: "rosemary", name: "迷迭香", shape: "grass", c1: "#81c784", c2: "#c8e6c9", cost: 20, cat: "草", lang: ["香味很旧的草本，像闻到了很远的事。", "迷迭香的花语是回忆与纪念——你负责记得，我负责替你留着味道。"] },
  { id: "sensitive", name: "含羞草", shape: "sensitive", c1: "#8bc34a", c2: "#aed581", cost: 24, cat: "趣", lang: ["碰一下就合拢叶子，过一会儿又悄悄打开。", "含羞草的花语是敏感细腻的心——害羞不是缺点，是心事比较多的表现。"] },
  { id: "venus", name: "捕蝇草", shape: "venus", c1: "#4caf50", c2: "#c62828", cost: 60, cat: "趣", lang: ["夹子一合，虫子无路可逃——花园里的治安担当。", "捕蝇草的花语是天然的守护——有些温柔长着牙齿，专门咬不怀好意的东西。"] },
  { id: "nepenthes", name: "猪笼草", shape: "nepenthes", c1: "#7cb342", c2: "#a1887f", cost: 65, cat: "趣", lang: ["挂着一个个小笼子，蜜是甜的，笼子是滑的。", "猪笼草的花语是甜蜜的陷阱——诱惑或许很甜，但底部往往什么都没有。"] },
  { id: "cactus", name: "仙人掌", shape: "cactus", c1: "#66bb6a", c2: "#f06292", cost: 30, cat: "多肉", lang: ["浑身是刺，心里全是水。", "仙人掌的花语是坚强与外刚内柔——把自己活成刺，是为了保护柔软的部分。"] },
  { id: "succulent", name: "多肉", shape: "succulent", c1: "#a5d6a7", c2: "#f48fb1", cost: 26, cat: "多肉", lang: ["胖胖的一小株，忘记浇水也能活得很好。", "多肉的花语是坚韧与质朴——把日子过胖一点，风雨就显不出瘦。"] },
  { id: "bamboo", name: "竹", shape: "bamboo", c1: "#8bc34a", c2: "#dcedc8", cost: 46, cat: "草木", lang: ["一节一节往上长，空着心，挺着腰。", "竹的花语是气节与虚心——站得直的人，心里都留着一段空。"] },
  { id: "ginkgo", name: "银杏", shape: "blossom", c1: "#ffd54f", c2: "#fff176", cost: 58, cat: "草木", lang: ["活了几亿年的树，秋天把满树金币撒了一地。", "银杏的花语是永恒的守候——有一种陪伴以百年为单位，不动声色。"] },
];

/* —— 小动物园丁（永久买断，随机认领植物慢慢干活）——
   tasks: water浇水 / fert施肥 / pest除虫；rate: 每小时恢复量 */
const ANIMAL_CATALOG = [
  { id: "earthworm", name: "蚯蚓", emoji: "🪱", cost: 15, tasks: ["fert"], rate: 1.6, desc: "松土施肥的地下工作者，慢是慢了点，但从不休息。" },
  { id: "snail", name: "蜗牛", emoji: "🐌", cost: 20, tasks: ["water"], rate: 1.2, desc: "背着房子浇水，速度感人，胜在风雨无阻。" },
  { id: "ladybug", name: "瓢虫", emoji: "🐞", cost: 25, tasks: ["pest"], rate: 2.0, desc: "专业除虫，一颗星都白不了。" },
  { id: "bee", name: "蜜蜂", emoji: "🐝", cost: 40, tasks: ["fert"], rate: 3.0, desc: "授粉小能手，勤劳界的天花板。" },
  { id: "frog", name: "青蛙", emoji: "🐸", cost: 60, tasks: ["water", "pest"], rate: 2.0, desc: "又能捉虫又能待在水边，一位园丁两份工。" },
  { id: "bird", name: "小山雀", emoji: "🐦", cost: 70, tasks: ["pest"], rate: 4.0, desc: "眼疾嘴快，虫子看见它就当场后悔出生。" },
  { id: "hedgehog", name: "刺猬", emoji: "🦔", cost: 110, tasks: ["pest", "fert"], rate: 2.4, desc: "夜里巡逻吃虫顺便松土，浑身带刺的好园丁。" },
  { id: "butterfly", name: "蝴蝶", emoji: "🦋", cost: 90, tasks: ["fert"], rate: 3.6, desc: "优雅的授粉官，飞过的花都开得更认真。" },
];

/* —— 消耗道具：点击植物立即回满对应值 —— */
const TOOL_CATALOG = [
  { id: "wateringcan", name: "浇水壶", emoji: "🪣", cost: 3, target: "water", desc: "立即把一株植物的水分回满。" },
  { id: "fertilizer", name: "肥料", emoji: "🧺", cost: 5, target: "fert", desc: "立即把一株植物的养分回满。" },
  { id: "pesticide", name: "除虫剂", emoji: "🧴", cost: 6, target: "pest", desc: "立即清空一株植物的虫害。" },
];

/* —— 花园装饰（纯装饰，让花园热闹起来）—— */
const DECOR_CATALOG = [
  { id: "firefly", name: "萤火虫", emoji: "✨", cost: 20, desc: "傍晚的花园里多出几点碎光。" },
  { id: "windchime", name: "风铃", emoji: "🎐", cost: 25, desc: "风一过，花园就有了声音。" },
  { id: "bench", name: "小长凳", emoji: "🪑", cost: 35, desc: "累了可以坐下来看看自己的花园。" },
  { id: "fence", name: "矮篱笆", emoji: "🪵", cost: 40, desc: "给花园围出一块像样的领地。" },
  { id: "pond", name: "小池塘", emoji: "⛲", cost: 80, desc: "有水的地方，花园就活了。" },
  { id: "greenhouse", name: "小温室", emoji: "🏡", cost: 150, desc: "花园的终极梦想，一座玻璃房子。" },
];

const PLANT_BY_ID = Object.fromEntries(PLANT_CATALOG.map((p) => [p.id, p]));
const ANIMAL_BY_ID = Object.fromEntries(ANIMAL_CATALOG.map((a) => [a.id, a]));

/* —— 花园地图皮肤（每张地图单独购买，可在已拥有的皮肤间自由切换）—— */
const MAP_SKINS = [
  { id: "grass",  name: "青草地",   cost: 0,   bg: "linear-gradient(160deg,#b7dda0,#9ccb84)", tile: "rgba(255,255,255,.22)", line: "rgba(90,130,70,.18)" },
  { id: "soil",   name: "沃土",     cost: 40,  bg: "linear-gradient(160deg,#cba57e,#a9835f)", tile: "rgba(255,255,255,.16)", line: "rgba(90,60,30,.20)" },
  { id: "moss",   name: "苔庭",     cost: 70,  bg: "linear-gradient(160deg,#8fae86,#6d8f6a)", tile: "rgba(255,255,255,.14)", line: "rgba(40,70,40,.22)" },
  { id: "sand",   name: "沙地",     cost: 90,  bg: "linear-gradient(160deg,#f0dcae,#dcc287)", tile: "rgba(255,255,255,.24)", line: "rgba(150,120,70,.20)" },
  { id: "pond",   name: "睡莲池",   cost: 130, bg: "linear-gradient(160deg,#a8d3e0,#7ab3c7)", tile: "rgba(255,255,255,.22)", line: "rgba(50,100,120,.18)" },
  { id: "snow",   name: "雪原",     cost: 170, bg: "linear-gradient(160deg,#eef4f8,#cfe0ec)", tile: "rgba(255,255,255,.55)", line: "rgba(120,150,175,.20)" },
  { id: "meadow", name: "花海",     cost: 210, bg: "linear-gradient(160deg,#f7d6e6,#e5b8d6)", tile: "rgba(255,255,255,.26)", line: "rgba(160,90,140,.16)" },
  { id: "night",  name: "星空夜园", cost: 260, bg: "linear-gradient(160deg,#2f3b63,#1e2745)", tile: "rgba(255,255,255,.10)", line: "rgba(200,220,255,.14)" },
];
const SKIN_BY_ID = Object.fromEntries(MAP_SKINS.map((s) => [s.id, s]));

/* 从花语长句里提取一句清爽的短语，用于商店列表 */
function shortMeaning(plant) {
  const m = /花语是(.+?)(?:——|$)/.exec(plant.lang[1] || "");
  return m ? m[1] : "";
}
