// 小鎮復興主線（docs/05 §4.2）：12 章，依「加入後第幾天＋等級」解鎖，每章一封村民的信
export interface Chapter {
  n: number;
  day: number;
  level: number;
  who: string;
  emoji: string;
  title: string;
  opens: string; // 開放內容說明
  letter: string[]; // 信的段落
  reward: { coins?: number; item?: string; count?: number; furn?: string };
}

export const STORY: Chapter[] = [
  { n: 1, day: 0, level: 1, who: '郵差小郵', emoji: '📮', title: '第一封信', opens: '訂單板、郵筒',
    letter: ['你好！我是負責這一帶的郵差小郵。', '聽說奶奶的農場有新主人了，鎮上的人都很開心。', '以後大家的訂單都會寄到你家門口的郵筒，有空就去看看吧！'],
    reward: { coins: 200 } },
  { n: 2, day: 14, level: 15, who: '木匠老木', emoji: '🔨', title: '木匠回來了', opens: '房屋擴建、工具箱、家具店',
    letter: ['我是老木，以前幫你奶奶蓋過那間小木屋。', '看你把農場整理得有模有樣，我這把老骨頭也想回來幫忙。', '房子要擴建、工具要升級、想買家具，都來找我。'],
    reward: { item: 'wood', count: 30 } },
  { n: 3, day: 30, level: 25, who: '雜貨店阿福', emoji: '🏪', title: '雜貨店開張', opens: '週末市集、流浪商人',
    letter: ['我是阿福，雜貨店重新開張啦！', '週末我會在你家門口的小徑旁擺攤，收購新鮮的作物；', '每個星期三還有一位神祕的流浪商人會路過，他那裡常有好東西喔。'],
    reward: { coins: 1500 } },
  { n: 4, day: 60, level: 35, who: '麵包師小麥', emoji: '🥖', title: '麵包的香味', opens: '進階加工配方',
    letter: ['我是小麥，小時候最愛吃你奶奶做的麵包。', '鎮上的烤爐又熱起來了，我把幾個私房配方抄給你。', '用你種的麥子烤出來的麵包，一定特別香。'],
    reward: { item: 'fert', count: 10 } },
  { n: 5, day: 90, level: 45, who: '花店花姐', emoji: '💐', title: '花開滿鎮', opens: '花藝裝飾（藤編花圈可以掛在大門上）',
    letter: ['我是花姐！鎮上的花圃荒廢好久了。', '聽說你的田裡什麼花都種得出來，可以分我一些種子嗎？', '作為回禮，送你一盆我最得意的盆栽。'],
    reward: { furn: 'stamp_spring' } },
  { n: 6, day: 120, level: 52, who: '獸醫白醫生', emoji: '🩺', title: '寵物健康檢查', opens: '寵物小屋升級、收養更多寵物（點寵物小屋）',
    letter: ['我是白醫生，幫你的小夥伴做了健康檢查。', '牠非常健康，而且看得出來被照顧得很好。', '這張寵物軟墊送給牠，要常常摸摸牠喔。'],
    reward: { furn: 'pet_bed' } },
  { n: 7, day: 150, level: 60, who: '裁縫阿布', emoji: '🧵', title: '裁縫的剪刀', opens: '服裝工坊（房子選單）',
    letter: ['我是阿布，鎮上的裁縫。', '你每天穿著同一件吊帶褲下田，我都看在眼裡啦！', '以後想換衣服就來找我，第一次免費。'],
    reward: { coins: 8000 } },
  { n: 8, day: 180, level: 67, who: '咖啡廳老闆', emoji: '☕', title: '咖啡廳開幕', opens: '咖啡廳特別訂單（郵筒）',
    letter: ['咖啡廳終於開幕了！', '我們的招牌是「農場直送」，所以會常常跟你下特別的訂單。', '價錢絕對不會讓你失望。'],
    reward: { coins: 12000 } },
  { n: 9, day: 210, level: 72, who: '養蜂人', emoji: '🐝', title: '蜜蜂回來了', opens: '蜂箱與蜂蜜（果園南邊）',
    letter: ['嗡嗡——我是養蜂人。', '你的花田讓蜜蜂們找到了新家。', '等蜂箱安頓好，就能收成香甜的蜂蜜了。'],
    reward: { item: 'fert', count: 20 } },
  { n: 10, day: 240, level: 78, who: '天文台爺爺', emoji: '🔭', title: '星空下的農場', opens: '望遠鏡、流星許願、夜間花長得更快',
    letter: ['年輕人，你知道嗎？你農場上空的星星特別亮。', '也許是因為夜間花的光吧。', '有空晚上來天文台，我們一起看星星。'],
    reward: { furn: 'moon_lamp' } },
  { n: 11, day: 300, level: 88, who: '鎮長', emoji: '🎩', title: '小鎮廣場', opens: '小鎮廣場（好友大廳）',
    letter: ['我代表全鎮的居民謝謝你。', '一年前這裡還是個快要沒人的小鎮，現在廣場上又熱鬧起來了。', '廣場隨時歡迎你和你的朋友們來玩。'],
    reward: { coins: 50000 } },
  { n: 12, day: 360, level: 95, who: '奶奶', emoji: '👵', title: '奶奶的日記', opens: '週年紀念',
    letter: ['孩子，當你讀到這封信時，農場應該已經被你照顧一整年了吧。', '我把這本日記留在閣樓裡，裡面寫著這塊土地所有的故事。', '謝謝你，讓它繼續開花結果。'],
    reward: { furn: 'wall_photo' } },
];

// 週末市集攤位、流浪商人
export const MARKET_BONUS = 1.5; // 市集收購價
export const MARKET_CAP = 10; // 每樣每個週末最多收幾個
export const PET_TREAT = { coins: 300, bond: 30, perWeek: 2 };
