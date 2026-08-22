# 0021. Aktivasyon Hunisi Instance İçinde, Telemetri Opt-In ve Varsayılan Kapalı

**Durum:** Kabul edildi
**Tarih:** 2026-08-14

> 🌐 [English (kanonik)](../../decisions/0021-activation-funnel-and-opt-in-telemetry.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Kurul kendi kullanımı hakkında hiçbir şey ölçmüyordu. `apps/` ve `docs/` altında
`telemetry`, `analytics`, `posthog`, `plausible`, `umami` araması kaynak kodda sıfır eşleşme
veriyordu; roadmap'in (bugünkü [ROADMAP.md](../../../ROADMAP.md)) "Beyond MVP" listesinde metrik
maddesi yoktu. Dolayısıyla her ürün sorusu sezgiyle yanıtlanıyordu:

- Onboarding nerede kopuyor — kayıt, workspace, board, ilk kart, ilk davet?
- Davetler dönüşüyor mu; dönüşmüyorsa suç davet akışında mı, yoksa SMTP aktarımı olmayan bir
  kurulumda mı (o durumda davetli zaten kabul _edemez_, bkz. ADR 0013)?
- Gelecek hafta geri dönen var mı — ve bunu **takım** olarak kullanan var mı? Ürünün bir
  yapılacaklar listesi yerine var olmasını haklı çıkaran tek kullanım biçimi budur.

Bunların hiçbiri tek kişilik bir bakıcı için lüks değil. Bir çeyreği insan kaybettiren şeye mi
yoksa yapması en kolay olan şeye mi harcayacağınızı belirler.

Bariz çözüm aynı zamanda en çok zarar verebilecek olan. Self-host kullanıcıları bu yazılımı
büyük ölçüde _kendilerini raporlamadığı için_ seçer; başarısızlık biçimi kaybedilen bir
kullanıcı değil, özelliğin değerinden uzun yaşayan "Kurul eve telefon ediyor" başlığıdır.
Birçok proje, ne kadar anonim olursa olsun, varsayılan açık bir ping için bu bedeli ödedi.

Bu yüzden iki soru ayrı ayrı yanıtlanmalı, çünkü yanıtları farklı:

1. Kurulum **kendini**, kendi operatörü için ölçebilir mi?
2. Kurulum **bize** bir şey söyleyebilir mi?

Şanslı bir ön koşul da var: `Activity` tablosu, feed yayına girdiğinden beri
`<özne>.<geçmiş zaman fiil>` biçiminde tip ve aktör tutuyor; PR #188 (denetim SEC-05) bu
kelime dağarcığının yönetsel yarısını — `board.*`, `column.*`, `label.*`, `workspace.updated`,
`member.*`, `invitation.*` — denetim izi için ekledi. Bir aktivasyon hunisinin çoğu zaten
veritabanında; asıl soru ne yazılacağı değil, nasıl okunacağıydı.

## Karar

**İki katman, birbirinden bağımsız kararlaştırıldı.**

### Katman 1 — aktivasyon hunisi, instance içinde, her zaman açık

On bir adım, bu kurulumun zaten tuttuğu satırlardan istek anında hesaplanır ve olağan API
üzerinden kurulum operatörüne sunulur (`GET /instance/activation`). **Burada hesaplanan hiçbir
şey hiçbir yere gönderilmez.**

| #   | Adım                 | Sayı nereden geliyor                                            |
| --- | -------------------- | --------------------------------------------------------------- |
| 1   | `user_registered`    | `COUNT(User)`                                                   |
| 2   | `workspace_created`  | `WorkspaceMember.userId` distinct, `role = OWNER`               |
| 3   | `board_created`      | `Activity` `board.created` üzerindeki distinct aktörler         |
| 4   | `first_task_created` | `task.created` üzerindeki distinct aktörler                     |
| 5   | `first_drag`         | `task.moved` üzerindeki distinct aktörler                       |
| 6   | `invite_sent`        | `invitation.created` üzerindeki distinct aktörler               |
| 7   | `smtp_configured`    | `MailService.isEnabled()` — kişi değil, kurulum                 |
| 8   | `invite_accepted`    | `invitation.accepted` distinct aktörler (aktör davet edilendir) |
| 9   | `dashboard_viewed`   | `dashboard_view` türünde `UsagePing` olan distinct kullanıcılar |
| 10  | `task_completed`     | `COMPLETED` bir kolona `task.moved` yapan distinct aktörler     |
| 11  | `wau_board_view`     | son 7 günde `board_view` `UsagePing` olan distinct kullanıcılar |

On birin dokuzu **türetilmiştir** — istek döngüsünde hiçbir yeni yazma yolu yok. İkisi değil ve
tek bir yeni tablo gerektirdi.

**Kuzey Yıldızı: Haftalık Aktif Takım Workspace'i.** İki veya daha fazla üyesi olan ve son yedi
günde iki veya daha fazla _mevcut_ üyesi iz bırakmış workspace'ler. Yanında iki bağlam sayısıyla
birlikte döner (her boyuttan haftalık aktif workspace, ve genel olarak 2+ üyeli workspace
sayısı), çünkü "3" dört takım workspace'i içinde mükemmel, dört yüz içinde krizdir.

**Kimler okuyabilir: `INSTANCE_ADMIN_EMAILS` (bu hesapların e-postaları doğrulanmışsa), varsayılan boş, yani hiç kimse.** Bu, kod
tabanındaki workspace rolü olmayan tek yetkilendirme sınırıdır ve huni, kiracılar arası okuma
yapması meşru olan ilk şey olduğu için vardır.

### Katman 2 — dışa telemetri, opt-in, varsayılan kapalı

Süreç başlangıcında tek bir `POST`, yalnızca operatör **hem** `TELEMETRY_ENABLED=true` **hem
de** `TELEMETRY_ENDPOINT` ayarladıysa. İkisinin de bir şey gönderen varsayılanı yoktur. Gönderilen
tam yük, başka hiçbir alan olmaksızın:

```json
{ "event": "instance_started", "version": "0.1.0" }
```

Kurulum kimliği yok, hostname yok, IP yok, sayaç yok, workspace veya kullanıcı verisi yok.
`await` edilmez, yeniden denenmez, açılışı düşüremez. `docs/development.md` bu alan listesini
verilen söz olarak tekrarlar; `@kurul/shared-types` içindeki `TelemetryPingPayload` ise
spesifikasyonudur — `telemetry.service.spec.ts` anahtar kümesinin tam olarak `event` ve
`version` olduğunu doğrular.

## Gerekçe

**Huni neden türetiliyor da yayınlanmıyor?** On bir servise on bir `INSERT` eklemek daha kısa
bir yama olurdu ve üç açıdan daha kötüdür. Türetilmiş huni _geriye dönüktür_ — bu sürüme
yükselen bir kurulum tüm geçmişini görür, deploy'da başlayan düz bir çizgi değil. Sızdıramaz:
PR #188'de düzeltilmesi gereken hata, davet edilen e-posta adresini her GUEST'in okuyabildiği
bir feed'e taşıyan bir `invitation.*` payload'ıydı; yalnızca şemada zaten var olan kolonları
okuyan bir sorgu için bu yapısal olarak imkânsızdır. Ve sıcak yolda hiçbir şey yavaşlamaz;
görev oluşturmak hâlâ tek bir transaction'dır.

**`UsagePing` yine de neden var?** `Activity` birinin _değiştirdiğini_ kaydeder. Her sabah
board'unu okuyup hiçbir şeyi taşımayan bir takım hiçbir şey değiştirmez; dolayısıyla yalnızca
`Activity`'den türetilen bir tutunma metriği en sessiz sağlıklı kurulumları ölü gösterirdi — tam
olarak vermesi gereken sinyali tersine çevirerek. Tablo "geldiler mi" sorusunu yanıtlayan asgari
veriyi tutar: (kullanıcı, workspace, tür, UTC gün) başına bir satır, tekil indeksle
tekilleştirilmiş ve `ON CONFLICT DO NOTHING` ile yazılmış. Board id yok, path yok, user agent
yok, adres yok, sayaç yok. Kendi penceresini büyütmek yerine mevcut gecelik iş tarafından
`ACTIVITY_RETENTION_DAYS` (ADR 0020) altında süpürülür — aynı sınıf satır, operatörün vereceği
tek karar.

**Bir `GET` neden yazıyor?** İki ping `GET /workspaces/:id/boards/:boardId` ve
`GET /workspaces/:id/dashboard/summary` içinde kaydedilir, tarayıcı beacon'ıyla değil. İstek
_görüntülemenin kendisidir_: handler'a ulaşmak guard'ın geçtiği ve workspace'in çözüldüğü
anlamına gelir; bunu hiçbir istemci çağrısı garanti edemez ve bir eklenti engelleyemez. Yazma
`await` edilmez ve her hata bir uyarıya yutulur; böylece dolu ya da eksik bir metrik tablosu bir
takımın board'unu görmesini engelleyemez. Fiilin saflığı burada hiçbir şey kazandırmaz: bu
dağıtımda yazan bir `GET`'in bozacağı ne bir cache ne de bir read replica vardır.

**Neden `INSTANCE_ADMIN_EMAILS`, neden bir rol değil?** Üç alternatif reddedildi. _Herhangi bir
workspace `OWNER`_ hiç sınır değildir — varsayılan kurulumda kayıt açıktır ve workspace
oluşturmak sizi sahibi yapar, yani her ziyaretçi rolü kendine verebilir. Bir `User.isAdmin`
_kolonu_ bir arayüz, denetlenecek bir yükseltme yolu ve ilk yönetici bootstrap sorunu
gerektirirdi: salt okunur tek bir ekran için kalıcı yeni bir saldırı yüzeyi. _Hiç sınır yok_ ise
PR #188 hatasının tekrarıdır — bir payload, ya da bir sayfa, bir şeyi kimin okuyabileceğini asla
genişletmemelidir ve kurulum genelindeki sayılar hiçbir workspace üyesinin hakkı olmadı.
Yapılandırma dürüst sınırdır: `DATABASE_URL`'i okuyabilen kişi, kurulum genelindeki sayıları
görecek hesapları adlandırabilir. Varsayılan boş olması, taze bir kurulumun bunu kimseye —
kendi sahibine bile — göstermemesi demektir; ta ki biri bilerek `.env`'e bir adres yazana kadar; ayrıca
erişim bu hesapların e-posta adreslerinin doğrulanmasını gerektirerek daha da sınırlanmıştır.

**Telemetri neden kapalı ve neden kurulum kimliği taşımıyor?** Varsayılan kapalı bir nezaket
değil; self-host yazılımın _amacıyla_ uyumlu tek varsayılandır. Bir anahtarı bulup kapatmak
zorunda kalan kullanıcıdan bir şey çoktan alınmıştır.

Kurulum kimliği daha zor karardı ve bilerek daha az faydalı tarafı seçtik. Kimlikle bir
toplayıcı kurulum sayar; kimliksiz _başlangıç_ sayar, yani sürekli çöken bir konteyner yüz
kurulum gibi, hiç yeniden başlamayan istikrarlı bir sunucu ise sıfır gibi görünür. Bu gerçek bir
sinyal kaybıdır. Ama sabit rastgele bir kimlik, bir dağıtım için takma adlı bir tanımlayıcıdır ve
bu anahtarı açmaya değer kılan söz, **güvene dayalı hiçbir şey olmaksızın** anonim olmasıdır —
ilişkilendirilecek kimlik yok, sızacak kimlik yok, operatörün "başka bir şeyle birleştirmediğimize"
inanmak zorunda olacağı kimlik yok. Kurulum sayısı isteyen gelecekteki bir bakıcı bunu bir yamada
alan ekleyerek değil, bir karar olarak yeniden açmalıdır.

**Neden varsayılan endpoint yok?** Bir tane göndermek, self-host kullanıcılarından denetlemeleri
istenen AGPL bir kod tabanına sabit kodlanmış üçüncü taraf bir adres koymak olurdu; ayrıca
Dravcore bugün bir toplayıcı yayınlamıyor — yanıt vermeyen bir alan adına işaret eden varsayılan,
kodun tutamayacağı bir sözdür. Hedefi operatöre adlatmak, "kendi toplayıcıma yönlendireyim"
kullanımını da geçici çözüm değil birinci sınıf bir kullanım hâline getirir.

## Sonuçlar

**Kolaylaşan.** Kuzey Yıldızı ilk kez ölçülebilir hâle gelir ve hunideki her düşüş bir tahmine
değil belirli bir adıma atfedilebilir. `smtp_configured` tam olarak "davet gönderildi" ile "davet
kabul edildi" arasında durur; böylece kötü bir dönüşüm "davet akışımız kafa karıştırıcı" yerine
"sunucumuz e-posta gönderemiyor" diye okunur. Self-host kullanıcısı kendi dağıtımı için aynı
ekranı alır: bu, onların donanımında çalışan bizim analitiğimiz değil, onların analitiğidir.

**Zorlaşan.** Göç ettirilecek ve süpürülecek yeni bir tablo var ve iki `GET` handler'ı artık
yazma yapıyor — bunu fark eden her incelemede savunulması gereken bir biçim. Huni sorgusu
`Activity` üzerinde altı toplama taramasıdır ve cache'lenmez; çok büyük bir kurulumda bu ekran
üründeki en yavaş sayfa olacaktır ve o gün geldiğinde çözüm bir indekstir, bayat bir kopya değil.

**Telemetri kararının dürüst bedeli.** Varsayılan kapalı olduğu, kimlik taşımadığı ve yayınlanmış
bir toplayıcısı olmadığı için yakın vadede kurulum sayıları hakkında neredeyse hiçbir şey
öğrenmeyeceğiz. Bu, verilen sözün bedelidir ve bilerek ödenmiştir. Anahtar, bir toplayıcı _olduğu_
gün tartışmanın çoktan bitmiş olması için ve kendi kurulumunun kalp atışını bir yere göndermek
isteyen operatörün desteklenen bir yolu olsun diye vardır.

**Operatörün bunları görmek için yapması gereken.** `INSTANCE_ADMIN_EMAILS`'i kendi adresine
ayarlamak, o hesabın e-postasını doğrulamak ve ayarlar ekranını yenilemek. Hiçbir şey yapmamak huniyi hesaplanmış ama okunamaz,
ping'i ise gönderilmemiş bırakır; ikisini de istememiş biri için doğru davranış budur.

## Değerlendirilen alternatifler

| Alternatif                                                    | Neden olmadı                                                                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Üçüncü taraf SDK (PostHog, Plausible, Umami, GA)              | Yapısı gereği veriyi makineden çıkarır, denetçinin güvenmek zorunda olduğu bir bağımlılık ekler ve "buradan ne çıkıyor" sorusunu dosya listesiyle yanıtlayamaz |
| Varsayılan açık anonim ping, opt-out                          | Self-host bir projeye itibarını kaybettiren tam da bu karardır; kapatmak için anahtar aramak zorunda kalan kullanıcı zaten kaybetmiştir                        |
| On bir servisten on bir sayaç yayınlamak                      | Deploy öncesi geçmiş yok, metrik başına yeni bir yazma yolu ve her biri bir payload'ın sızabileceği bir yer (bkz. PR #188)                                     |
| Huniyi her workspace `OWNER`'ına açmak                        | Sınır değil: açık kayıt + "workspace oluştur" herkesi sahip yapar                                                                                              |
| Arayüzlü bir `User.isAdmin` kolonu                            | Salt okunur tek bir ekran için kalıcı bir yetki yükseltme yüzeyi ve bir bootstrap sorunu                                                                       |
| Tarayıcıdan `POST /usage` beacon'ı                            | Sayfa görüntüsü başına ikinci bir gidiş-dönüş, ve "board'u açtı mı" gerçeği bir eklentinin engelleyebileceği istemci koduna taşınır                            |
| Her board görüntülemesini saklamak (günlük tekilleştirme yok) | Bu bir metrik değil, gezinme geçmişidir; soru "geldiler mi", asla "kaç kez"                                                                                    |
| Ayrı bir `USAGE_PING_RETENTION_DAYS`                          | Aynı sınıf satır için sessizce çelişebilecek iki pencere; ADR 0020'nin `ACTIVITY_RETENTION_DAYS`'i politikayı zaten belirtiyor                                 |
| Ping'e sabit bir kurulum kimliği koymak                       | Bir dağıtım için takma adlı tanımlayıcı; anonimlik sözü kurulum sayısından daha değerli (bkz. Gerekçe)                                                         |
