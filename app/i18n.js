'use strict';
// Interface language: English (default) or Cantonese (written, Traditional Chinese).
// In Cantonese mode, interface text is translated as it appears on screen (exact phrases + patterns for text with
// names and numbers). What people type — messages, captions, names — stays as written.

const LANG = (() => { try { return localStorage.getItem('lang') || 'en'; } catch { return 'en'; } })();
const LOCALE = LANG === 'yue' ? 'zh-HK' : undefined;
function setLanguage(lang) {
  try { localStorage.setItem('lang', lang); } catch {}
  location.reload();
}

const YUE = {
  // Navigation & common
  'Home': '主頁', 'Chat': '傾偈', 'Chats': '傾偈', 'Moments': '回憶', 'Us': '我哋', 'New moment': '新增回憶', 'Share a moment': '分享回憶',
  'Calendar': '日曆', 'Shopping': '買餸', 'Cat': '貓貓', 'Stickers': '貼紙', 'Settings': '設定', 'Main': '主選單', 'Twofold': 'Twofold',
  'Save': '儲存', 'Save changes': '儲存變更', 'Cancel': '取消', 'Close': '關閉', 'Delete': '刪除', 'Edit': '編輯', 'Undo': '還原', 'Add': '加',
  'Remove': '移除', 'Done': '完成', 'Copy': '複製', 'Copied': '已複製', 'Copied to clipboard': '已複製', 'Rename': '改名', 'Dismiss': '關閉',
  'Today': '今日', 'Yesterday': '尋日', 'Saved': '已儲存', 'Photo': '相片', 'Photos': '相片', 'Links': '連結', 'Link': '連結', 'Loved': '最愛', 'All': '全部',
  'Camera': '相機', 'Choose photo': '揀相', 'Choose photos': '揀相', 'Photos / videos': '相片／影片', 'Your photo': '你嘅相', 'Your photos & videos': '你嘅相片同影片',
  'Send': '傳送', 'Message': '訊息', 'Zoom': '縮放', 'Date': '日期', 'Time': '時間', 'Note': '備註', 'Notes': '備註', 'Name': '名', 'Place': '地點',
  'Next month': '下個月', 'Previous month': '上個月', 'Group': '分類', 'Emoji': 'Emoji', 'Default': '預設', 'Restore': '還原', 'Move': '移動',

  // Onboarding
  'A private space': '專屬你哋', 'for just you two': '兩個嘅空間', 'Keep your messages, photos and moments together. Nobody else can see inside.': '將你哋嘅訊息、相片同回憶收埋一齊，冇其他人睇到。',
  'Start fresh': '重新開始', 'Restore backup': '還原備份', 'Your name': '你嘅名', 'Partner or best friend': '另一半或好朋友', 'Together since (optional)': '一齊咗由幾時開始（可以唔填）',
  'Create our space': '建立我哋嘅空間', 'Choose backup file': '揀備份檔案', 'Stored privately on your device': '只會儲喺你部機', 'Backup file': '備份檔案',
  'Choose moments-backup.json': '揀 moments-backup.json', 'Browse': '瀏覽', 'e.g. Mia': '例如：阿 Mia', 'e.g. Leo': '例如：阿 Leo',
  'Opened as a file.': '你係直接開咗個檔案。', 'Photo scanning, cut-outs and offline mode need the app to run from a web address. Close this tab and double-click': '掃描相片、AI 剪貼紙同離線模式要用網址開先用到。請關咗呢個分頁，喺 app 資料夾㩒兩下',
  'Start Twofold': '「Start Twofold」', 'in the app folder instead.': '開返。',

  // Home
  "Today's moment": '今日嘅回憶', 'Capture': '影低佢', 'Recent moments': '最近嘅回憶', 'See all': '睇晒', 'Plan it': '計劃吓', 'together': '一齊咗',
  'saved so far': '已經儲低', 'Add': '加', 'Add your anniversary and birthdays': '加入紀念日同生日', 'Add your person': '加入你嘅另一半',
  'Partner, best friend or family': '另一半、好朋友或者屋企人', 'Open settings': '打開設定', 'Tap the heart to send a nudge': '㩒心心提吓佢',
  'Your moments will show up here. Tap + to share the first one.': '你嘅回憶會喺度出現。㩒 + 分享第一個。', 'Anniversary': '紀念日', 'Hi': '你好',
  'Share something that made you smile today': '分享今日令你笑嘅嘢', 'Show what you are eating right now': '影吓你而家食緊乜', 'Capture the view from where you are': '影低你身邊嘅景色',
  'Share something that reminded you of them': '分享一樣令你諗起佢嘅嘢', 'Show a tiny detail you noticed today': '影低今日留意到嘅小細節', 'Share what you are listening to': '分享你聽緊嘅歌',
  'Capture your favourite corner of today': '影低今日最鍾意嘅角落', 'Share something you are grateful for': '分享一樣令你感恩嘅嘢', 'Show the sky above you right now': '影吓你頭頂嘅天空',
  'Share a film, show or post you loved lately': '分享最近鍾意嘅電影、劇或者帖文', 'Capture something that made you laugh': '影低令你笑嘅嘢', 'Share a place you want to go together': '分享一個想一齊去嘅地方',
  'Open shopping list': '打開購物清單',

  // Composer & moments
  'Edit moment': '編輯回憶', 'Caption': '文字', 'What made this moment special?': '呢個時刻有咩特別？', 'Mood': '心情', 'Happy': '開心', 'Grateful': '感恩',
  'Missing you': '掛住你', 'Cozy': '舒服', 'Adventurous': '冒險', 'Link, place, date & albums': '連結、地點、日期同相簿', 'Where were you?': '你喺邊度？',
  'Albums': '相簿', '#travel #movies': '#旅行 #電影', 'From Instagram, Threads, Letterboxd, IMDb, Reddit…': '由 Instagram、Threads、Letterboxd、IMDb、Reddit…',
  'Share after saving': '儲存後分享', 'Opens WhatsApp, Instagram or Messages': '會打開 WhatsApp、Instagram 或者訊息', 'Save moment': '儲存回憶', '+ Add more': '+ 再加',
  'Remove photo': '移除相片', 'Remove video': '移除影片', 'Our moments': '我哋嘅回憶', 'Search moments': '搵回憶', 'Search words, #albums, places, apps': '搵文字、#相簿、地點、app',
  "Play this month's recap": '播放今個月回顧', 'Updated': '已更新', 'Saved to your moments': '已儲存到回憶', 'Add a photo, a video, a caption or a link': '加張相、影片、文字或者連結',
  'Nothing matches that.': '搵唔到。', 'No moments yet. Tap + to share your first one.': '仲未有回憶。㩒 + 分享第一個。', 'Tap to open': '㩒嚟睇',
  'Delete this moment?': '刪除呢個回憶？', 'Add some photos first': '請先加啲相', 'Shared photos': '分享過嘅相',

  // Chat
  'Start a chat with…': '同邊個傾偈…', 'New chat': '新傾偈', 'All chats': '所有傾偈', 'Saved on this device': '儲喺呢部機', 'Chat options': '傾偈選項',
  'Send photos or videos': '傳送相片或影片', 'Emoji and stickers': 'Emoji 同貼紙', 'Voice message or speak to type': '語音訊息或講嘢打字', 'Editing message': '編輯緊訊息',
  'Cancel edit': '取消編輯', 'Recording voice message…': '錄緊語音訊息…', 'Send voice message': '傳送語音訊息', 'Cancel selection': '取消選擇', 'Make a moment': '整成回憶',
  'Change background': '轉背景', 'Select messages': '選擇訊息', 'Delete chat': '刪除傾偈', 'Chat background': '傾偈背景', 'Your photo ': '你嘅相',
  'Blush': '粉紅', 'Sage': '淺綠', 'Sky': '天藍', 'Sand': '沙色', 'Lavender': '薰衣草', 'Night': '夜晚', 'Dots': '波點', 'Hearts': '心心', 'Paws': '貓腳印',
  'Save to Moments': '儲存到回憶', '♡ Save to Moments': '♡ 儲存到回憶', 'Saved to Moments': '已儲存到回憶', 'Select more…': '再揀多啲…', 'Message deleted': '已刪除訊息',
  'Message edited': '已編輯訊息', 'Tap messages to select them': '㩒訊息嚟揀', 'Start a chat first': '請先開始傾偈', 'Chat deleted': '已刪除傾偈', 'Chat name': '傾偈名稱',
  'Quick replies': '快速回覆', 'Tap one in the chat to send it instantly.': '喺傾偈度㩒一下即刻傳送。', 'Reset to default': '回復預設', 'Edit quick replies': '編輯快速回覆',
  'Move up': '向上移', 'Add a reply, e.g. 到咗未？': '加一句，例如：到咗未？', '+ Make stickers': '+ 整貼紙', 'Record a voice message': '錄語音訊息',
  'Speak to type · 廣東話': '講嘢打字 · 廣東話', 'Speak to type · 普通話': '講嘢打字 · 普通話', 'Speak to type · English': '講嘢打字 · English',
  'On iPhone you can also tap the 🎤 key on the keyboard to dictate in Cantonese.': '喺 iPhone 你亦可以㩒鍵盤上面嘅 🎤 用廣東話講嘢打字。',
  'Listening… speak now': '聽緊…請講', 'Could not hear that, try again': '聽唔清楚，再試一次', 'Microphone permission was not given': '未有咪高峰權限',
  'Voice recording is not supported in this browser': '呢個瀏覽器唔支援錄音', 'Speech-to-text is not available here. On iPhone, tap the 🎤 key on the keyboard instead.': '呢度用唔到語音轉文字。喺 iPhone 請㩒鍵盤上面嘅 🎤。',
  'Start a chat.': '開始傾偈。', 'edited': '已編輯', 'Sticker': '貼紙', '📷 Photo': '📷 相片', '🎬 Video': '🎬 影片', '🎙 Voice message': '🎙 語音訊息', 'Say hi 👋': '打個招呼 👋',

  // Us & settings
  'Pictures': '頭像', 'Your picture': '你嘅頭像', "Partner's picture": '另一半嘅頭像', 'Together since': '一齊咗由幾時開始', 'Appearance': '外觀', 'Auto': '自動',
  'Light': '淺色', 'Dark': '深色', 'Language': '語言', 'Special dates': '特別日子', 'Birthdays and anniversaries repeat every year and count down on Home.': '生日同紀念日每年重複，會喺主頁倒數。',
  "e.g. Leo's birthday": '例如：阿 Leo 生日', 'Add date': '加日子', 'Backup to your computer': '備份到電腦', 'Download backup': '下載備份',
  'Everything is stored on this device only. Download a backup file regularly and restore it on any device.': '所有嘢只會儲喺呢部機。記得定期下載備份，可以喺任何裝置還原。',
  'Add a name and a date': '請輸入名同日期', 'Change picture': '換頭像', 'Use initial': '用名嘅第一個字', 'Or use a sticker': '或者用貼紙', 'Change photo': '換相',
  'Choose a photo first': '請先揀相', 'Choose a photo': '揀相',
  'Add a plan…': '加行程…', 'Add plan': '加行程', 'Nothing planned yet.': '仲未有安排。', 'Special date': '特別日子', 'All day': '全日',
  'Add to Apple/Google/Outlook calendar': '加到 Apple／Google／Outlook 日曆', 'Moment': '回憶',

  // Shopping
  'From your checklist': '由你嘅清單', 'Turn the meal-plan photo into a shopping list': '將餐單相變成購物清單',
  'The photo is read on this device. Rows that start with a date (e.g. 20261018) become meals in your calendar.': '張相只會喺呢部機讀取。以日期開頭嘅行（例如 20261018）會變成日曆入面嘅餐單。',
  'Scan photo': '掃描相片', 'Paste text': '貼上文字', 'Read text': '讀取文字', 'Starting…': '準備中…', 'Starting the reader…': '準備讀字工具…', 'Shopping list': '購物清單', 'Meal plan': '餐單',
  'Paste the list here. Tip: on iPhone, open the photo, long-press the text, tap Select All → Copy (Live Text), then paste.': '喺度貼上清單。提示：喺 iPhone 打開張相，長按啲字，㩒「全選」→「複製」，再貼喺度。',
  'Check what was read': '檢查讀到嘅內容', 'Orange boxes were auto-corrected or hard to read. Tap to fix; your fixes are remembered next time.': '橙色格係自動改過或者睇唔清楚嘅。㩒入去改；你改過嘅字下次會記得。',
  'Show original photo': '顯示原圖', 'Other items (no date)': '其他（冇日期）', '+ Item': '+ 項目', '+ Add a day': '+ 加一日', 'Looks good — make my list': '冇問題——整清單',
  'Remove row': '刪除呢行', 'Dish': '菜式', 'Shopping list ready': '購物清單整好咗', 'Share list': '分享清單', 'Clear list': '清除清單', 'Clear this shopping list?': '清除呢張購物清單？',
  'All done! 🎉': '全部買齊！🎉', 'Add to calendar': '加到日曆', 'Update calendar': '更新日曆', 'Saved to your calendar': '已儲存到日曆',
  'Save them to see each day’s ingredients in the calendar': '儲存之後可以喺日曆睇每日要用嘅材料', 'No date': '冇日期', 'Meal': '餐',
  'No list yet. Scan the checklist photo or paste its text above.': '仲未有清單。喺上面掃描清單相或者貼上文字。', 'No items found in that text': '段文字入面搵唔到項目',
  'Could not find any items. Try "Paste text" instead.': '搵唔到項目，試吓用「貼上文字」。', 'Remove meal': '刪除餐單', 'Reading the list': '讀緊清單',
  'Vegetables · 蔬菜': '蔬菜', 'Fruit · 水果': '水果', 'Meat · 肉類': '肉類', 'Seafood · 海鮮': '海鮮', 'Dairy, eggs & tofu · 蛋奶豆腐': '蛋奶豆腐', 'Pantry & sauces · 乾貨調味': '乾貨調味', 'Other · 其他': '其他',
  'Loading tesseract core': '載入讀字工具', 'Loading language traineddata': '載入中文資料', 'initializing api': '準備中', 'initializing tesseract': '準備中',

  // Cat
  'Cat diary': '貓貓日記', 'Track meals, litter, play, moods, weight and vet visits': '記錄食飯、砂盆、玩、心情、體重同睇獸醫',
  'Quick taps build a picture of their normal routine, so you can spot changes early.': '隨手㩒一下，慢慢就知道佢平時嘅習慣，有咩唔對路都早啲發現。',
  'Add your cat': '加入你隻貓', '+ Add cat': '+ 加貓貓', 'Edit profile': '編輯資料', 'Log now': '即刻記錄', 'Coming up': '快到', 'Diary': '日記', 'Show earlier days': '顯示之前嘅日子',
  'Hide': '收埋', 'Ate': '食飯', 'Drank': '飲水', 'Litter': '砂盆', 'Nap': '瞓覺', 'Play': '玩', 'Affection': '撒嬌', 'Grumpy': '發脾氣', 'Vomit': '嘔',
  'Weight': '體重', 'Medicine': '食藥', 'Vaccine': '疫苗', 'Vet visit': '睇獸醫', 'Grooming': '美容', 'Add your cat ': '加入你隻貓', 'Birthday (or adoption day)': '生日（或者領養日）',
  'Vet': '獸醫', 'Clinic name & phone': '診所名同電話', 'Food brand, allergies, microchip number…': '貓糧牌子、敏感、晶片號碼…', 'Delete cat': '刪除貓貓',
  'Delete this cat and all of its diary entries?': '刪除呢隻貓同佢所有日記？', 'Weight (kg)': '體重（kg）', 'Next due (reminder on Home & calendar)': '下次到期（會喺主頁同日曆提你）',
  'Add photo': '加相', 'Delete entry': '刪除紀錄', 'Entry': '紀錄', 'Enter the weight': '請輸入體重', 'Saved to the diary': '已儲存到日記', 'Reminder': '提醒',
  'e.g. drug name & dose, vaccine type, clinic': '例如：藥名同份量、疫苗種類、診所', 'What happened? A milestone, a funny moment…': '發生咩事？里程碑、搞笑時刻…', 'Add a note (optional)': '加備註（可以唔填）',
  'Everything looks like their usual pattern this week.': '今個星期一切同平時差唔多。', 'Keep logging for two weeks and changes from their usual pattern will show here.': '持續記錄兩個星期，同平時唔同嘅地方就會喺度顯示。',
  'Tap edit to add a birthday': '㩒編輯加生日', 'e.g. Mochi': '例如：Mochi',

  // Sync
  '🔒 Sync with your partner': '🔒 同另一半同步', 'Create our private space': '建立我哋嘅私人空間', 'Join': '加入', 'Paste the invite link': '貼上邀請連結',
  'Messages, moments, plans, the shopping list and the cat diary sync between both of your phones and computers. Everything is encrypted on your device first, so the server only ever stores scrambled data.': '訊息、回憶、行程、購物清單同貓貓日記會喺你哋嘅手機同電腦之間同步。所有嘢會先喺你部機加密，伺服器只會儲到亂碼。',
  'Invite / add a device': '邀請／加裝置', 'Sync now': '即刻同步', 'Disconnect': '中斷連接', 'Synced': '已同步', 'Problem': '問題', 'Connecting…': '連接緊…',
  'waiting to send': '個等緊傳送', 'items on the server': '項喺伺服器', 'You are': '你係', 'Invite your partner': '邀請另一半', 'Send the invite link': '傳送邀請連結',
  'Copy link': '複製連結', 'Join our private Twofold space:': '加入我哋嘅 Twofold 私人空間：',
  'Anyone with this link can read your space, so only send it to your partner (WhatsApp is fine — it is encrypted) or use it on your own devices.': '有呢條連結嘅人就可以睇到你哋嘅空間，所以只可以傳畀另一半（用 WhatsApp 冇問題，佢有加密），或者喺你自己嘅裝置用。',
  'Who are you on this device?': '呢部機係邊個用？', 'Your messages and moments will show under this name.': '你嘅訊息同回憶會用呢個名顯示。', "I'm": '我係',
  'The person who created the space': '建立空間嘅人', "I'm the partner who was invited": '我係被邀請嘅另一半', 'That invite link does not look right': '條邀請連結唔啱',
  'This device is already connected': '呢部機已經連接咗', 'Could not join: ': '加入唔到：', 'Add your name to finish': '加埋你個名就完成', 'Connected — your space is syncing': '已連接——你哋嘅空間同步緊',
  'Stop syncing on this device? Everything stays on this device, and you can join again with the invite link.': '喺呢部機停止同步？所有資料會留喺呢部機，之後可以用邀請連結再加入。',
  'Sync needs your Twofold web address': '同步要用你嘅 Twofold 網址', 'Could not create the space': '建立唔到空間',
  'Open Twofold from your Cloudflare address (…workers.dev) to turn on sync. See the README for the 5-minute setup.': '請用你嘅 Cloudflare 網址（…workers.dev）打開 Twofold 先開到同步。設定步驟睇 README，大約 5 分鐘。',
  'Join partner': '加入另一半', 'Invite link from your partner': '另一半傳畀你嘅邀請連結', 'Opening the link on this phone works too.': '喺呢部手機直接開條連結都得。',

  // Cat break
  '🐱 Cat break': '🐱 貓貓小休', 'Call the cat': '叫貓貓出嚟', 'Your cat takes over the screen so you rest your eyes. Use your own videos or photos.': '貓貓會霸住個畫面，等你休息吓對眼。可以用你自己嘅影片或相片。',
  'Add clip': '加片段', 'Remove clip': '移除片段', 'Break length': '休息時間', 'Remind me every': '每隔幾耐提我', 'When idle for (screensaver)': '冇郁幾耐之後（屏幕保護）',
  'Off': '關', '1 min': '1 分鐘', '2 min': '2 分鐘', '3 min': '3 分鐘', '5 min': '5 分鐘', '10 min': '10 分鐘', '15 min': '15 分鐘', '20 min': '20 分鐘', '30 min': '30 分鐘', '45 min': '45 分鐘', '1 hour': '1 小時', '1½ hours': '1.5 小時',
  'Works while Twofold is open. Shortcut: Alt + C. On a computer, allow notifications so the cat can call you from another window.': 'Twofold 開住先會運作。快捷鍵：Alt + C。喺電腦請允許通知，咁貓貓喺其他視窗都叫到你。',
  'Time for a break': '休息吓啦', 'Pop out': '彈出', '+1 min': '+1 分鐘', 'Hold to end': '按住結束', 'Pop-out is not available here': '呢度用唔到彈出', 'Pop-out is not available in this browser': '呢個瀏覽器用唔到彈出',

  // Stickers
  '✂️ Cut-out': '✂️ 剪出主體', 'Circle': '圓形', 'Square': '方形', 'Heart': '心形', 'Shape': '形狀', 'Select subject (AI)': '選取主體（AI）', 'Erase': '擦走', 'Wand': '魔術棒',
  'Brush size': '筆刷大小', 'Wand tolerance': '魔術棒範圍', 'Edge softness': '邊緣柔和度', 'Outline': '外框', 'White outline': '白色外框', 'Black outline': '黑色外框', 'Rose outline': '玫瑰紅外框',
  'e.g. miss u': '例如：掛住你', 'e.g. Mochi, Funny, Love': '例如：Mochi、搞笑、愛心', 'Save sticker': '儲存貼紙', 'My stickers': '我嘅貼紙',
  'Drag the photo to position it.': '拖動相片調整位置。', 'Drag to position the photo first, then tap ✨ Select subject.': '先拖動相片調整位置，再㩒 ✨ 選取主體。',
  'Paint over anything you want to remove.': '塗走你唔要嘅部分。', 'Paint over parts of the subject to bring them back.': '塗返主體被擦走嘅部分。', 'Tap a background colour to remove it.': '㩒背景顏色就會擦走。',
  'Finding the subject…': '搵緊主體…', 'Loading the cut-out model…': '載入 AI 模型…', 'Done! Use Erase / Restore to touch up the edges': '完成！用「擦走／還原」修飾邊緣',
  'Tap ✨ Select subject to cut it out': '㩒 ✨ 選取主體剪出嚟', 'Cut-out reset because the photo moved': '相片移動咗，剪裁已重設', 'The sticker is empty — try Undo': '貼紙係空嘅——試吓還原',
  'Stickers you make will appear here, ready to use in Chat.': '整好嘅貼紙會喺度出現，可以喺傾偈用。', 'Share (e.g. to WhatsApp)': '分享（例如 WhatsApp）', 'Download PNG': '下載 PNG',
  'Move to group': '移去分類', 'Sticker deleted': '已刪除貼紙', 'The AI cut-out needs the app to be started with “Start Twofold”': 'AI 剪裁要用「Start Twofold」開 app 先用到',
};

// Text with names or numbers. Each entry: [regex, replacement string or function]; `t` translates captured parts.
const t = s => trCore(s);
const YUE_PATTERNS = [
  [/^Hi, (.+)$/, (_, n) => `你好，${n}`],
  [/^(星期.|週.) (morning|afternoon|evening)$/, (_, d, p) => `${d}${{ morning: '早晨', afternoon: '下晝', evening: '夜晚' }[p]}`],
  [/^([\d,]+) days?$/, '$1 日'], [/^([\d,]+) days together$/, '一齊咗 $1 日'], [/^since (.+)$/, '由 $1 開始'],
  [/^(\d+) moments?$/, '$1 個回憶'], [/^(\d+) photos?$/, '$1 張相'], [/^(\d+) videos?$/, '$1 段片'], [/^(\d+) meals?$/, '$1 餐'],
  [/^(\d+) items? to buy$/, '要買 $1 樣'], [/^(\d+) of (\d+) in the basket$/, '已放入籃 $1／$2'], [/^(\d+) selected$/, '揀咗 $1 個'],
  [/^(\d+) (entry|entries) today$/, '今日 $1 個紀錄'], [/^(\d+) years? old$/, '$1 歲'], [/^(\d+) months? old$/, '$1 個月大'],
  [/^Day ([\d,]+)$/, '第 $1 日'], [/^(.+) is today$/, (_, l) => `${t(l)} 就係今日`], [/^(.+) is tomorrow$/, (_, l) => `${t(l)} 就係聽日`],
  [/^(.+) in (\d+) days$/, (_, l, n) => `${t(l)} 仲有 ${n} 日`],
  [/^Send (.+) some love$/, '傳啲愛畀 $1'], [/^Send (.+) a nudge$/, '提吓 $1'], [/^Sent (.+) a nudge$/, '已經提咗 $1'],
  [/^You: (.*)$/, (_, r) => `你：${t(r)}`], [/^You shared (\d+) moments? today$/, '今日分享咗 $1 個回憶'],
  [/^Nothing shared yet today$/, '今日仲未分享'], [/^(.+) will love it$/, '$1 一定鍾意'],
  [/^On this day · (\d+) years? ago$/, '往年今日 · $1 年前'], [/^A memory · (.+)$/, '回憶 · $1'],
  [/^Saved from (.+)$/, '來自 $1'], [/^Open in (.+)$/, '喺 $1 打開'], [/^Post to (.+)$/, '發佈到 $1'],
  [/^Share with (.+)… \(WhatsApp, Instagram, Messages\)$/, '同 $1 分享…（WhatsApp、Instagram、訊息）'], [/^Share… \(WhatsApp, Instagram, Messages\)$/, '分享…（WhatsApp、Instagram、訊息）'],
  [/^Save & share with (.+)$/, '儲存並同 $1 分享'], [/^Save & share$/, '儲存並分享'], [/^Opens WhatsApp, Instagram or Messages to send to (.+)$/, '會打開 WhatsApp、Instagram 或訊息傳畀 $1'],
  [/^Message (.+)$/, '傳訊息畀 $1'], [/^Say hi to (.+) 👋$/, '同 $1 打個招呼 👋'], [/^Sent (.+)$/, '已傳送 $1'], [/^(.+) · edited$/, '$1 · 已編輯'],
  [/^Options for (.+)$/, '$1 嘅選項'], [/^♥ (.+)$/, '♥ $1'], [/^(\d+) messages deleted$/, '已刪除 $1 個訊息'],
  [/^Delete the chat with (.+) and all its messages\?$/, '刪除同 $1 嘅傾偈同所有訊息？'],
  [/^(.+)'s picture$/, '$1 嘅頭像'], [/^Edit (.+)$/, '編輯 $1'], [/^Vet: (.+)$/, '獸醫：$1'],
  [/^(.+)'s birthday$/, '$1 生日'], [/^(.+)'s birthday 🎂$/, '$1 生日 🎂'], [/^(.+)'s (vaccine|medicine|vet visit|grooming)$/, (_, n, k) => `${n} ${t(k[0].toUpperCase() + k.slice(1))}`],
  [/^(.+) due$/, (_, l) => `${t(l)}到期`], [/^Next due (.+)$/, '下次到期 $1'], [/^(.+) logged$/, (_, l) => `已記錄 ${t(l)}`], [/^(.+) deleted$/, (_, l) => `已刪除 ${t(l)}`],
  [/^Last (ate|litter|play): (\d+) (min|h|d) ago$/, (_, k, n, u) => `上次${{ ate: '食飯', litter: '砂盆', play: '玩' }[k]}：${n} ${{ min: '分鐘', h: '小時', d: '日' }[u]}前`],
  [/^(\d+) vomits in the last 7 days\. If it keeps happening, check with your vet\.$/, '過去 7 日嘔咗 $1 次。如果持續，請問吓獸醫。'],
  [/^(.+) logged (\d+)% less than usual this week\.$/, (_, l, n) => `今個星期${t(l)}比平時少咗 ${n}%。`],
  [/^(.+) logged (\d+)% more than usual this week\.$/, (_, l, n) => `今個星期${t(l)}比平時多咗 ${n}%。`],
  [/^Meals$/, '食飯'], [/^Litter visits$/, '去砂盆'], [/^Drinking$/, '飲水'], [/^Naps$/, '瞓覺'],
  [/^Weight (up|down) (\d+)% since (.+)\.$/, (_, d, n, s) => `體重由 ${s} 至今${d === 'up' ? '升' : '跌'}咗 ${n}%。`],
  [/^Tap a button above to start (.+)'s diary\.$/, '㩒上面嘅掣開始寫 $1 嘅日記。'],
  [/^(.+) says: time for a break\. Stretch, blink, drink some water\.$/, '$1 話：休息吓啦。伸吓懶腰、眨吓眼、飲啖水。'], [/^(.+) is keeping your seat warm$/, '$1 幫你霸住個位'],
  [/^Added (\d+) meals? to the calendar$/, '已加 $1 餐到日曆'], [/^Also buying: (.+)$/, '仲要買：$1'],
  [/^Reading cell (\d+) of (\d+)$/, '讀緊第 $1／$2 格'], [/^Read as “(.+)”$/, '原本讀到「$1」'],
  [/^Sticker saved to “(.+)”$/, '貼紙已儲存到「$1」'], [/^All \((\d+)\)$/, '全部（$1）'], [/^Restored (\d+) items$/, '已還原 $1 項'],
  [/^Could not (restore|read the photo|run the cut-out): (.*)$/, (_, k, e) => `${{ restore: '還原唔到', 'read the photo': '讀唔到張相', 'run the cut-out': 'AI 剪裁失敗' }[k]}：${e}`],
  [/^Using ([\d.]+) MB on this device\.$/, '呢部機用咗 $1 MB。'], [/^Add your "together since" date in Settings$/, '喺設定加入「一齊咗由幾時開始」'],
  [/^(.+) is over (\d+) MB.*$/, '$1 超過 $2 MB'], [/^Move to which group\? \((.*)\)$/, '移去邊個分類？（$1）'],
  [/^React (.+)$/, '回應 $1'],
  [/^(\d+) waiting to send$/, '$1 個等緊傳送'], [/^([\d.]+) MB · (\d+) items on the server$/, '$1 MB · $2 項喺伺服器'],
  [/^You are (.+)$/, '你係 $1'], [/^Synced (.+)$/, '已同步 $1'], [/^I'm (.+)$/, '我係 $1'], [/^Problem: (.+)$/, '問題：$1'],
];

const trCache = new Map();
function trCore(s) {
  if (YUE[s] != null) return YUE[s];
  for (const [re, rep] of YUE_PATTERNS) {
    const m = s.match(re);
    if (m) return typeof rep === 'string' ? s.replace(re, rep) : rep(...m);
  }
  const lead = s.match(/^([^\p{L}\p{N}]+)(\p{L}.*)$/u); // leading emoji / symbols
  if (lead) { const r = trCore(lead[2]); if (r !== lead[2]) return lead[1] + r; }
  if (s.includes(' · ')) { const parts = s.split(' · '), out = parts.map(trCore); if (out.some((p, i) => p !== parts[i])) return out.join(' · '); }
  return s;
}
function T(s) {
  if (LANG !== 'yue' || typeof s !== 'string' || !/[A-Za-z]/.test(s)) return s;
  const key = s.trim();
  if (!trCache.has(key)) trCache.set(key, trCore(key));
  const r = trCache.get(key);
  return r === key ? s : s.replace(key, r);
}

// Translate the page as it changes.
if (LANG === 'yue') {
  document.documentElement.lang = 'zh-HK';
  const ATTRS = ['placeholder', 'aria-label', 'title'];
  const skip = el => el?.closest?.('[translate="no"], textarea, script, style');
  const doText = n => { if (!skip(n.parentElement)) { const v = T(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } };
  const doEl = el => {
    if (el?.closest?.('[translate="no"]')) return;
    for (const a of ATTRS) { const v = el.getAttribute?.(a); if (v) { const r = T(v); if (r !== v) el.setAttribute(a, r); } }
  };
  const walk = root => {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    doEl(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) n.nodeType === 3 ? doText(n) : doEl(n);
  };
  new MutationObserver(muts => muts.forEach(m => {
    if (m.type === 'characterData') doText(m.target);
    else if (m.type === 'attributes') doEl(m.target);
    else m.addedNodes.forEach(walk);
  })).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  document.addEventListener('DOMContentLoaded', () => walk(document.body));
}
