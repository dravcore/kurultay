# 0018. Yerelleştirme Stratejisi: URL Yönlendirmesi Olmadan next-intl

**Durum:** Kabul edildi
**Tarih:** 2026-08-12
**Güncellendi:** 2026-08-21: aşağıdaki iki key sayısı farklı anların fotoğrafı ve o zamandan beri
birlikte ilerledi: `en.json` ve `tr.json` bugün her biri 514 yaprak key taşıyor, katalog-parity
kapısının şart koştuğu gibi hâlâ birbirine eşit.

> 🌐 [English (kanonik)](../../decisions/0018-localization-strategy.md) | Türkçe

## Bağlam

Ürün planı, İngilizce arayüzü baştan sona bitirmek ve ardından ikinci dil olarak Türkçeyi
eklemek. Bu da şu soruyu doğurdu: Türkçe için doğru araç next-intl mi, yoksa farklı bir
yaklaşım mı gerekiyor?

Dar sorunun cevabı şu: next-intl zaten kullanılan araç ve bir süredir öyle.
`NextIntlClientProvider` root layout'u sarıyor, `getLocale()` / `getMessages()` onu besliyor,
53 dosya `useTranslations` veya `getTranslations` çağırıyor ve `apps/web/messages/en.json`
yaklaşık 279 anahtar tutuyor. `formatRelativeTime` sabit `'en'` yerine zaten bir locale
parametresi alıyor. Uygulamayı tek dilli tutan tek şey `apps/web/i18n/request.ts` içindeki
tek satır:

```ts
const locale = 'en';
```

Yani asıl karar "hangi kütüphane" değil, o satırın ertelediği üç soru: locale nasıl seçilecek,
tercih nerede yaşayacak ve mesaj kataloğunda değil veritabanında duran metinlere ne olacak?

Cevabı iki kısıt şekillendiriyor. Birincisi, Kurul'daki her sayfa kimlik doğrulama arkasında
— indekslenecek içerik yok ve bir tanıtım ya da dokümantasyon sitesi yapılırsa bu Next.js
uygulamasının dışında yaşayacak. İkincisi, `apps/api` tarafında hiç locale farkındalığı yok:
hatalar sabit kodlar ve bir HTTP durumu olarak dönüyor, web bunları `resolveApiMessage` ile
çeviri anahtarlarına eşliyor.

Bu ADR ürün yerelleştirmesi hakkında. Depo dokümantasyonundaki "İngilizce kanonik + `docs/tr`
aynası" kuralı ayrı ve ilgisiz bir gelenektir.

## Karar

next-intl kalıyor; ikinci bir i18n kütüphanesi getirilmiyor. Locale, **URL yönlendirmesi
olmadan**, `apps/web/i18n/request.ts` içinde uygulanan bir zincirden çözülüyor:

```
User.locale  →  locale çerezi  →  Accept-Language  →  'en'
```

`[locale]` yol parçası yok, i18n middleware'i yok. Bunun yanında:

1. **Locale kullanıcı düzeyinde bir tercihtir**, `User` üzerinde nullable bir IETF etiketi
   olarak saklanır ve kullanıcı dil seçtiğinde bir çereze yansıtılır. Workspace ayarı değildir.
2. **Backend arayüz çevirisinden uzak durur.** API hata kodları ve durumları döndürmeye devam
   eder; mesaj kataloğunun sahibi web'dir. API `Accept-Language`'ı yalnızca kullanıcı adına
   veritabanına yazdığı içerik için ve giden e-postalar için okur.
3. **Saklanan metinler yeniden adlandırılabilirlik kuralına uyar:** kullanıcı yeniden
   adlandırabiliyorsa o kullanıcı verisidir — yaratıcının dilinde tohumla ve düz string olarak
   sakla. Kullanıcı yeniden adlandıramıyorsa (`priority`, roller, enum etiketleri) sistem
   verisidir — enum'u sakla, çeviriyi web yapsın.
4. **İngilizce kanonik kalır.** `messages/en.json` tek doğruluk kaynağıdır; `tr.json` ancak
   İngilizce arayüz tamamlandığında eklenir.

## Gerekçe

- `[locale]` yol parçasının tek gerçek getirisi SEO'dur: her dil için ayrı URL artı `hreflang`.
  Kurul'da indekslenen hiçbir şey yok, dolayısıyla bu getiri geçerli değil; ona ihtiyaç
  duyacak tanıtım sitesinin de başka yerde yaşaması planlanıyor.
- Yol parçasının maliyeti ise anında ve eksiksiz ödenir: tüm `app/` ağacı `app/[locale]/`
  altına taşınır ve her `<Link>` ile `router.push` next-intl'in locale-farkında
  sarmalayıcılarına geçmek zorunda kalır — bu geçişi kaçıran her çağrı yeri kullanıcının dilini
  sessizce sıfırlar, doğal olarak yakalayan bir testi olmayan sessiz bir hata biçimi.
- Middleware maliyeti ilk bakışta göründüğünden ağır. `apps/web/middleware.ts` zaten var ve her
  route'u oturuma karşı geçitliyor; üstelik tüm yönlendirme mantığı **literal yol eşlemesi**:
  `/login`, `/register` ve `/verify-email` tutan bir `PUBLIC_PATHS` kümesi, bir
  `pathname.startsWith('/invite/')` kontrolü ve kök yönlendirmesi için `pathname === '/'`. Dil
  öneki bu karşılaştırmaların hepsini birden geçersiz kılar. Dolayısıyla yönlendirmeli i18n'e
  geçmek, next-intl'in middleware'ini auth geçidiyle bileştirmek **ve** aynı değişiklikte auth
  geçidinin eşlemesini yeniden yazmak demek — hatanın kullanıcıları oturumdan atacağı ya da daha
  kötüsü kimliksiz bir isteği içeri alacağı tek dosyada.
- next-intl, yönlendirmesiz kurulumu birinci sınıf bir yapılandırma olarak belgeliyor;
  dolayısıyla bu seçim kütüphaneye ters düşmüyor ve desteklenen yolun dışına çıkmıyor.
- Workspace düzeyi yerine kullanıcı düzeyi, çünkü bir workspace meşru şekilde farklı diller
  okuyan üyeler barındırır. Workspace geneli bir ayar, bunlardan birini yanlış arayüze mahkûm
  ederdi.
- Çeviriyi backend'in dışında tutmak aynı kataloğu iki kez sürdürmeyi önler. API zaten kodlarla
  konuşuyor; ona iki dilde düzyazı vermek web'in kataloğuyla API'nin kataloğunun ayrışmasına
  yol açardı.

## Sonuçlar

- `User` nullable bir `locale` sütunu ve bir migration kazanır; bir ayarlar ekranı bunu açığa
  çıkarmalıdır. Giden e-postaların alıcının dilini bilmesi gerektiği için tercih yalnızca
  çerezde değil veritabanında yaşamak zorundadır.
- `apps/web/i18n/request.ts` çözümleme zincirini ve dil değişiminde bir çerez yazımını kazanır.
- Kimlik doğrulaması olmayan route'lar — özellikle `/invite/[invitationId]` — `Accept-Language`
  üzerinden çözülür, yani davet edilen kişi oturum açmadan kendi dilini görür. İstenen davranış
  budur ve davet akışının yol parçası yaklaşımını zorunlu kılmamasının başlıca sebebidir.
- Paylaşılan bir board URL'i dil taşımaz: alıcı onu göndericinin değil **kendi** dilinde görür.
  Bilinçli olarak kabul edildi; genellikle insanların istediği de budur.
- İki dili yan yana incelemek ayrı tarayıcı profilleri ya da gizli pencere gerektirir.
- **Ertelendi, reddedilmedi:** bir tanıtım veya dokümantasyon sitesi bir gün bu uygulamanın
  _içine_ taşınırsa, `[locale]` yönlendirmesi o noktada getirilmek zorundadır ve geçiş yukarıda
  anlatılan tam maliyettir. Erteleme bir gözden kaçırma değil bir karar olarak kalsın diye
  tetikleyici burada kayıtlıdır.
- Bundan sonra kullanıcıya görünen her yeni metin `messages/en.json` üzerinden geçer. Sabit
  kodlanmış bir string kestirme değil bir kusurdur, çünkü Türkçe turuna görünmez ve eksik
  anahtar olarak da ortaya çıkmaz.
- API daha önce hiç sahip olmadığı küçük bir locale farkındalığı — `Accept-Language` okuma —
  kazanır. Bu, veritabanı tohumlaması ve e-posta ile sınırlıdır.
- **Tohum kolon adları `@kurul/shared-types`'ta değil API'de yaşar.** §3 bunu açık bıraktığı
  için uygulama sırasında karara bağlandı. Bu adlar API'nin kullanıcı adına yazdığı veridir ve
  web tohumlamayı bıraktığı anda — `POST …/columns/defaults` onun üç istekli döngüsünün yerini
  aldı — API tek yazıcı hâline geldi. Paylaşılan bir kopya, tarayıcının hiç render etmediği bir
  liste için her dilin tohum sözcüklerini bundle'a taşırdı. Paylaşılan kalan şey
  `SUPPORTED_LOCALES`'tir; o gerçekten sınırı geçer: web seçiciyi ondan üretir, API `PATCH /me`'yi
  ona karşı doğrular. Tohum listesinin yapısal yarısı (position, `ColumnCategory`) adlardan ayrı
  tutulur, böylece bir çeviri bir kolonu yerinden oynatamaz veya anlamını değiştiremez.
- Bir dil eklemek `SUPPORTED_LOCALES`'e yapılan bir değişiklik, artı ardından kendiliğinden
  patlayan üç yerdir: API'nin tohum adları `Record<Locale, …>`'ı ve mail metinleri
  `Record<Locale, …>`'ı derlenmeyi bırakır, `messages/<tag>.json` ise var olup İngilizce ile
  key key eşleşene kadar katalog parity testini düşürür. Veri migration'ı yok, `User.locale`
  backfill'i yok — sütun nullable kalır ve null "tarayıcıyı izle" demeye devam eder.
- `GET /me`, `User.locale`'i session'dan değil veritabanından okur. Better Auth session
  kullanıcısını 60 saniye boyunca bir çerezde önbelleğe alır ve web'in zinciri `/me`'ye
  başvurur; session'da taşınan bir locale, kullanıcı dili değiştirdikten sonra arayüzü 60
  saniyeye kadar eski dilde bırakırdı.
- **§4'ün koşulu karşılandı: Türkçe geldi.** İngilizce arayüz tamamlandığı için
  `messages/tr.json` onun karşısına yazıldı — 486 key, aynı key kümesi, aynı ICU argümanları.
  Tohum kolon adları bir `tr` satırı kazandı (`Yapılacak / Devam Ediyor / Bitti`) ve iki
  transactional e-posta da artık alıcının dilinde yazılıyor. İngilizce kanonik kalır: yeni bir
  metnin eklendiği dosya hâlâ `en.json`'dır ve Türkçe katalog ona göre ölçülür.
- **Rol adları arayüzde çevrilir (`Sahip / Yönetici / Üye / Misafir`), `docs/tr/**` içinde ise
  İngilizce kalır (`owner'ından`, `admin'e`) — bu bir drift değil, bilinçli bir ayrım.** Doküman
  `OWNER`/`ADMIN` enum değerlerinden ve `@kurul/auth-access` rol tanımlayıcılarından söz eder
  ve bunlar hiç çevrilmez; arayüzdeki rozet ise bir insanın okuduğu bir kelimedir.
- **"%100 çevrildi" bir iddia değil, bir kapıdır.** `apps/web/messages/catalog.test.ts`,
  `en.json`'da olup başka bir katalogda olmayan bir key'de, başka bir katalogda olup
  İngilizce'de olmayan bir key'de ve ICU argümanları iki dosya arasında farklılaşan bir mesajda
  build'i düşürür. Sabit bir `['tr']` yerine `SUPPORTED_LOCALES`'i okur; böylece üçüncü dil,
  ilan edildiği gün kapının arkasına girer. Bunu başka hiçbir şey yakalayamaz: next-intl eksik
  bir mesajı çalışma zamanında ham key yoluna çözer, dolayısıyla yarım çevrilmiş bir locale
  derlenir, tip kontrolünden geçer ve kullanıcıya `app.board.column.deleteAction` gösterir.
- **Giden e-posta, ortada bir request yokken bir dil çözer ve zinciri arayüzünkinden bir halka
  uzundur.** §2 yalnızca "ve giden e-posta için" dediği için bu, uygulama sırasında karara
  bağlandı. Zincir şu: `alıcının User.locale'i → gönderenin User.locale'i → tetikleyen
request'in Accept-Language'i → 'en'` (`apps/api/src/mail/recipient-locale.ts`). Karar olan
  halka ortadaki: bir davet, bu instance'ta hiç hesabı olmayan bir adrese gidebilir, dolayısıyla
  okunacak bir tercihi yoktur. Bu kişileri İngilizce'ye düşürmek yerine davet, onu gönderen
  kişinin dilinde yazılır — bu alışverişte dili bilinen tek insan odur, o adrese yazmayı o
  seçmiştir ve davet zaten onun adını vererek dilini ele verir. Doğrulama e-postasında ise
  eyleyen ile alıcı aynı yeni hesaptır, yani zincir kayıt oldukları tarayıcıya iner. Başarısız
  bir okuma bir sonraki halkaya düşer ve loglanır; kendisini tetikleyen kaydı ya da daveti asla
  düşürmez.
- **Mail metinleri, tohum adlarıyla aynı gerekçeyle API'de bir `Record<Locale, …>`'dır.** Arayüz
  metni değildir — hiçbir şey onu bir izleyicinin dilinde yeniden render etmez — ve
  `SUPPORTED_LOCALES`'e eklenen bir dil, e-posta metinleri var olana kadar derlenmez; böylece
  bir locale, arayüzü çevrilmiş ama e-postası İngilizce halde gelemez. Bunu format string'leri
  değil fonksiyonlar tablosu yapan şey kelime sırasıdır: Türkçe workspace adını fiilden önce,
  fiili en sona koyar; ortak bir `{inviter} invited you to {workspace}` şablonu dillerden birini
  diğerinin gramerine zorlardı.

## Değerlendirilen alternatifler

| Alternatif                                                      | Neden olmadı                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[locale]` yol parçası (next-intl'in yönlendirmeli varsayılanı) | SEO getirisi indekslenebilir sayfası olmayan bir uygulamada geçersiz; buna karşılık tüm route ağacına, mevcut auth middleware'inin literal yol eşlemesinin yeniden yazılmasına ve bugünden başlayan kalıcı link disiplinine mal oluyor |
| Workspace düzeyinde locale                                      | Bir workspace meşru şekilde farklı diller okuyan üyelere sahiptir; ortak bir ayar birini yanlış dile mahkûm eder                                                                                                                       |
| Backend i18n (`nestjs-i18n`, `Accept-Language` ile düzyazı)     | Web'in zaten sahip olduğu kataloğu ikizler ve ayrışmalarına izin verir; API zaten `resolveApiMessage` ile eşlenen kodlar döndürüyor                                                                                                    |
| react-i18next veya Lingui'ye geçmek                             | next-intl 53 dosyada zaten entegre ve App Router'ın doğal seçeneği; takas hiçbir şey kazandırmaz, çalışan kodu yeniden yazar                                                                                                           |
| İstek anında makine çevirisi                                    | Ürün sözlüğü öngörülemez hale gelir, istek başına gecikme ve maliyet doğar, metni kullanıcı görmeden gözden geçirmenin yolu kalmaz                                                                                                     |
