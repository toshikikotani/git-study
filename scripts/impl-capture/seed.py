"""Sample data for rendering the app's screens. October rows come from the user's screenshots."""
import random
import uuid
from datetime import date, timedelta

U = '00000000-0000-0000-0000-000000000001'
random.seed(7)
out = []
q = lambda s: "'" + str(s).replace("'", "''") + "'"
n = lambda v: 'null' if v is None else (q(v) if isinstance(v, str) else str(v))

G = {}  # name -> id, filled from DB via subselect
def gid(name):
    return f"(select id from genres where user_id={q(U)} and name={q(name)})"

ACC = {'cash': str(uuid.UUID(int=0x30000000000000000000000000000001)),
       'card': str(uuid.UUID(int=0x30000000000000000000000000000002)),
       'bank': str(uuid.UUID(int=0x30000000000000000000000000000003))}
out.append(f"""insert into accounts (id,user_id,name,institution_name,kind,purpose,current_balance_yen,balance_updated_on,closing_day,payment_day,sort_order) values
({q(ACC['cash'])},{q(U)},'現金',null,'cash','living',12400,'2026-10-20',null,null,1),
({q(ACC['card'])},{q(U)},'楽天カード','楽天カード','credit_card','living',-48210,'2026-10-20',25,27,2),
({q(ACC['bank'])},{q(U)},'給与口座','三井住友銀行','bank','salary',386500,'2026-10-20',null,null,3);""")

out.append(f"update app_settings set payday=5, monthly_take_home_yen=275000 where user_id={q(U)};")
out.append(f"update genres set show_on_home=true where user_id={q(U)} and name in ('食料品','通信費');")

rows = []
def tx(d, name, yen, genre, branch=None, items=None, status='actual', acc='card', income=False, note=None, src='manual', conf=None):
    rows.append(dict(id=str(uuid.uuid4()), d=d, name=name, yen=yen, genre=genre, branch=branch,
                     items=items or [], status=status, acc=acc, income=income, note=note, src=src, conf=conf))

D = lambda m, d: date(2026, m, d)
FS, GA, CA, SAKE, NI, IF, KO, GO, IR, HO, TS, SHO = ('食料品', '外食', 'カフェ・飲料', '酒', '日用品', '衣服・ファッション', '交通・車両', '娯楽・趣味', '医療・健康', '保険・税金・手数料', '通信費', '書籍・学習')

# ---- today: came in automatically, waiting for the evening check-in ----
tx(D(10, 21), 'ファミリーマート', 230, FS, 'KITTE大阪店', [('レッドブルSF', 230, FS)], src='gmail', conf=0.95)
tx(D(10, 21), '日本交通', 3100, KO, src='gmail', conf=0.92)
tx(D(10, 21), '三井のリパーク', 800, KO, src='gmail', conf=0.55)
tx(D(10, 21), 'なんばウォークショップ', 453, FS, None, [('ボン・デ・リング', 162, FS), ('サクッと香る蒸込みトマチキパイ', 291, FS)], src='gmail', conf=0.9)

# ---- October (screenshots) ----
tx(D(10, 20), 'ファミリーマート', 189, FS, 'KITTE大阪店', [('タリーズブラック390', 189, FS)])
tx(D(10, 19), 'サイゼリヤ', 1100, GA)
tx(D(10, 19), 'ファミリーマート', 230, FS, 'KITTE大阪店', [('レッドブルSF', 230, FS)])
tx(D(10, 18), '日本交通', 3100, KO)
tx(D(10, 18), '豊津 ファミマ', 400, NI, acc='cash')
tx(D(10, 18), '近畿日本鉄道株式会社', 3280, KO)
tx(D(10, 18), 'なんばウォークショップ', 453, GA, None, [('ボン・デ・リング', 162, FS), ('サクッと香る蒸込みトマチキパイ', 291, FS)])
tx(D(10, 17), '同窓会', 5000, GA, acc='cash')
tx(D(10, 17), 'スーパーセルフ熊谷SS', 2000, KO, None, [('出光ゼアス 12.20L', 2000, KO)])
tx(D(10, 17), 'タイムズ垂水町', 2750, KO)
tx(D(10, 17), 'ジュンク堂書店', 2970, SHO)
tx(D(10, 17), 'ファミリーマート', 230, FS, 'KITTE大阪店', [('レッドブルSF', 230, FS)])
tx(D(10, 17), 'ドトール', 480, CA)
tx(D(10, 17), 'ライフ', 1030, FS, '豊津店')
tx(D(10, 16), 'ファミリーマート', 230, FS, 'KITTE大阪店', [('レッドブルSF', 230, FS)])
tx(D(10, 16), 'ファミリーマート', 129, FS, 'KITTE大阪店', [('ウィルキンソン タンサン', 129, FS)])
tx(D(10, 16), 'サイゼ', 1300, GA, acc='cash')
tx(D(10, 16), '御座候', 400, GA, acc='cash')
tx(D(10, 16), '娯楽・趣味', 2000, GO, acc='cash')
tx(D(10, 16), 'スギ薬局', 429, NI, '豊津店', [('ボカリスエット1.5L', 213, FS), ('エスセレクト ミレーフライ 2コ×単108', 216, FS)])
tx(D(10, 15), 'ファミリーマート', 189, FS, 'KITTE大阪店', [('タリーズブラック390', 189, FS)])
tx(D(10, 15), 'マツモトキヨシ', 73, CA, '西梅田店', [('510ml スパークリング', 73, CA)])
tx(D(10, 15), '上本町駅南おかとう耳鼻咽喉科', 1400, IR)
tx(D(10, 15), 'アイン薬局', 360, IR, '上6店')
tx(D(10, 15), 'サイゼリヤ', 1000, GA)
tx(D(10, 14), 'スギ薬局', 387, FS, '豊津店', [('*#!野菜', 192, FS), ('#!新レジ袋 エコ原料配合', 4, NI), ('*#!野菜', 191, FS)])
tx(D(10, 14), 'ファミリーマート', 213, CA, 'KITTE大阪店', [('ライオンキャラメルオレ', 213, CA)])
tx(D(10, 14), 'ファミリーマート', 138, CA, '大阪府大阪市北淀川1丁目8号2番地', [('炭酸酸水 1L', 138, CA)])
tx(D(10, 14), '乾燥機　14分', 200, IF, acc='cash')
tx(D(10, 14), 'まいばすけっと', 512, FS)
tx(D(10, 13), 'ファミリーマート', 130, CA)
tx(D(10, 13), 'ファミリーマート', 171, CA, '大阪北区梅田店', [('ジャスミン茶950', 171, CA)])
tx(D(10, 13), 'スキ薬局豊津店', 400, FS, acc='cash')
tx(D(10, 12), '夢ゴリラ', 3110, GA)
tx(D(10, 12), 'すし酒場さしす', 2332, GA, None, [('微アルカルピス', 429, GA), ('微アルレモン', 429, GA), ('寿司屋のポテサラ', 385, GA), ('サーモン', 550, GA), ('納豆巻', 539, GA)])
tx(D(10, 12), 'ライフ', 581, FS, '豊津店', [('キリ 10P', 398, FS), ('スタイルBシャルドネSP', 183, FS)])
tx(D(10, 12), 'スキ薬局豊津店', 1342, FS, None, [('ブルガリアヨーグルト', 238, FS), ('レンゲ 純粋ハチミツ', 698, FS), ('エスセレクト ブルー', 108, FS), ('果物', 295, FS), ('比新レジ袋 エコ原料配合', 3, NI)])
tx(D(10, 11), 'リフレクション', 700, GO, acc='cash')
tx(D(10, 11), 'タイムズ垂水町', 550, KO)
tx(D(10, 11), 'セブン-イレブン', 389, GA, '吹田垂水町3丁目店', [('鰹節昆布ツナマヨ', 160, FS), ('サルサソースのウインナーパン', 226, FS), ('バイオ30レジ袋中1枚', 3, NI)])
tx(D(10, 11), 'セブン-イレブン', 281, FS, None, [('鉛筆HB 3本パック', 132, NI), ('プレミアム ジャスミン茶 600ml', 149, FS)])
tx(D(10, 11), 'セブン-イレブン', 230, FS, '3丁目店', [('レッドブルシュガーフリー 250', 230, FS)])
tx(D(10, 11), 'モスバーガー', 890, GA, None, [('モス野菜バーガー党', 540, FS), ('ポテトL党', 350, FS)])
tx(D(10, 10), 'ガソリン', 2000, KO, acc='cash')
tx(D(10, 10), '駐車場　タイムズ', 3300, KO, acc='cash')
tx(D(10, 10), 'ラブルネ', 1200, FS, None, [('クロワッサンサンド', 420, FS), ('パンスイス', 322, FS), ('塩プール', 238, CA), ('フィナンシェ', 220, CA)])
tx(D(10, 10), '三井のリパーク', 800, KO)
tx(D(10, 10), 'サムギョプサル', 2000, FS, acc='cash')
tx(D(10, 10), 'タイムズ24株式会社', 550, KO)
tx(D(10, 10), '通信費', 2370, TS, acc='bank')
tx(D(10, 9), 'スギ薬局', 453, FS, '豊津店', [('昌味ひきわりミニ3', 98, FS), ('ビタミンDEドロップまご', 352, FS), ('新レジ袋エコ原料配合', 3, NI)])
tx(D(10, 9), 'ダイソー', 550, NI)
tx(D(10, 9), 'ライフ', 1197, FS, '豊津店', [('まごころ(真っ赤い)', 298, FS), ('エスセレクト 伊賀の豚肉', 498, FS), ('野菜', 203, FS), ('野菜', 198, FS)])
tx(D(10, 9), 'ファミリーマート', 69, SAKE, '吹田垂水町一丁目店', [('スーパーCHレモン3', 69, SAKE)])
tx(D(10, 8), 'ファミリーマート', 522, GA, 'KITTE大阪店', [('午後ティーエスプレッソ', 201, CA), ('大きなまくろたくあん', 318, GA), ('レジ袋', 3, GA)])
tx(D(10, 8), 'スギ薬局', 278, FS, '豊津店', [('*#!野菜', 278, FS)])
tx(D(10, 8), 'ダイエー', 300, FS, acc='cash')
tx(D(10, 8), 'ファミリーマート', 210, CA)
tx(D(10, 7), 'ココカラファイン', 127, CA, '阪神大阪梅田駅店', [('*紅茶花伝 Rミルクティー', 127, CA)])
tx(D(10, 7), 'studio REFLEXION', 1050, GO)
tx(D(10, 7), 'ファミリーマート', 138, FS, 'KITTE大阪店', [('強炭酸水 1L', 138, FS)])
tx(D(10, 7), 'リフレクション', 1900, GO, acc='cash')
tx(D(10, 6), 'Zepp なんば', 8800, GO)
tx(D(10, 5), '給料', 275000, None, acc='bank', income=True)
tx(D(10, 5), 'チケットぴあ', 12000, GO)
tx(D(10, 4), '焼肉ライク', 1480, GA)
tx(D(10, 3), 'ライブ物販', 9400, GO)
tx(D(10, 3), 'ライフ', 2140, FS, '豊津店')
tx(D(10, 2), '車保険', 32000, HO, acc='bank')
tx(D(10, 1), 'ファミリーマート', 230, FS, 'KITTE大阪店')
tx(D(10, 23), 'ハンブレッターズ', 6000, GO, status='scheduled')

# ---- July–September: same habits, generated ----
POOL = [
    ('ファミリーマート', FS, 120, 420, 'KITTE大阪店'), ('ファミリーマート', CA, 120, 260, None), ('スギ薬局', FS, 250, 1400, '豊津店'),
    ('ライフ', FS, 500, 2600, '豊津店'), ('セブン-イレブン', FS, 150, 600, None), ('サイゼリヤ', GA, 800, 1500, None),
    ('夢ゴリラ', GA, 2400, 3600, None), ('タイムズ垂水町', KO, 400, 2800, None), ('ガソリン', KO, 2000, 4000, None),
    ('ドトール', CA, 300, 600, None), ('ダイソー', NI, 110, 880, None), ('マツモトキヨシ', NI, 200, 1500, '西梅田店'),
    ('リフレクション', GO, 700, 2200, None), ('焼肉ライク', GA, 1100, 1900, None),
]
d0 = date(2026, 7, 1)
while d0 < date(2026, 10, 1):
    weekend = d0.weekday() >= 5
    for _ in range(random.randint(2, 5 if weekend else 3)):
        name, g, lo, hi, br = random.choice(POOL)
        yen = random.randint(lo // 10, hi // 10) * 10 + random.choice([0, 0, 8, 9])
        tx(d0, name, yen, g, br)
    if d0.day == 5:
        tx(d0, '給料', 275000, None, acc='bank', income=True)
    if d0.day == 2:
        tx(d0, '車保険', 32000, HO, acc='bank')
    if d0.day == 10:
        tx(d0, '通信費', 2370, TS, acc='bank')
    if d0.day == 20 and d0.month in (8, 9):
        tx(d0, 'ライブチケット', random.choice([7800, 8800, 9900]), GO)
    d0 += timedelta(days=1)

for r in rows:
    yen = r['yen'] if r['income'] else -r['yen']
    g = 'null' if r['genre'] is None else gid(r['genre'])
    cls = 'unclassified' if r['genre'] is None else ('rule' if r['src'] != 'manual' else 'manual')
    if r['genre'] is None: rev = "'auto_ok', null"
    elif r['src'] != 'manual': rev = "'auto_ok', null" if (r['conf'] or 0) >= 0.8 else "'pending', null"
    else: rev = "'confirmed', now()"
    out.append(
        f"insert into transactions (id,user_id,account_id,occurred_on,amount_yen,description,merchant_name,branch_name,source,classified_by,confidence,review_status,reviewed_at,genre_id,status,payment_method) values "
        f"({q(r['id'])},{q(U)},{q(ACC[r['acc']])},{q(r['d'].isoformat())},{yen},{q(r['name'])},{q(r['name'])},{n(r['branch'])},'{r['src']}','{cls}',{n(r['conf'])},{rev},{g},{q(r['status'])},'one_time');")
    for i, (iname, iyen, ig) in enumerate(r['items']):
        out.append(f"insert into receipt_items (user_id,transaction_id,name,amount_yen,sort_order,genre_id) values ({q(U)},{q(r['id'])},{q(iname)},{-iyen},{i},{gid(ig)});")

# fixed costs the user confirmed
out.append(f"insert into fixed_cost_confirmations (user_id,subscription_key) values ({q(U)},'車保険:-32000'),({q(U)},'通信費:-2370') on conflict do nothing;")

# spending plan (目標) for 10/6〜11/5
P = str(uuid.UUID(int=0x40000000000000000000000000000001))
out.append(f"insert into spending_plans (id,user_id,period_start,period_end,step_percent,created_at) values ({q(P)},{q(U)},'2026-10-06','2026-11-05',10,'2026-10-06T00:00:00Z');")
for gname, yen in [(GO, 33300), (GA, 42500), (KO, 23400), (FS, 22700), (CA, 6130), (SAKE, 2600), (NI, 4600), (IR, 3000), (SHO, 3000)]:
    out.append(f"insert into spending_plan_items (plan_id,user_id,genre_id,target_yen) values ({q(P)},{q(U)},{gid(gname)},{yen});")

# savings goal
out.append(f"insert into goals (user_id,title,target_amount_yen,target_date,current_amount_yen,start_on) values ({q(U)},'貯金',100000,'2026-12-31',80000,'2026-10-01');")

open(__import__('sys').argv[1], 'w').write('begin;\n' + '\n'.join(out) + '\ncommit;\n')
print(len(rows), 'transactions')
