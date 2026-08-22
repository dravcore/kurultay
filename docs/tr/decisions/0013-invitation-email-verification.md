# 0013. Davet Kabulünde E-posta Doğrulaması

**Durum:** Kabul edildi
**Tarih:** 2026-08-10

> 🌐 [English (canonical)](../../decisions/0013-invitation-email-verification.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Better Auth'un organization plugin'i bir advisory taşıyor, GHSA-fmh4-wcc4-5jm3: doğrulanmamış
bir e-posta eşleşmesi üzerinden yetkisiz davet kabulü. Bir davet bir hesabı değil bir e-posta
adresini hedefler; plugin daveti o adresle eşleşen _herhangi bir_ hesaptan kabul ediyorsa, önce
kayıt olan bir saldırgan — davet edilen adresle, gerçek sahibi hiç kayıt olmadan önce — daveti
ele geçirip onun yerine workspace'e katılabilir. Better Auth 1.6, kontrolü tamamen kaldırmak
yerine plugin'in _varsayılanını_ sağlamlaştırdı: `accept-invitation` ve `get-invitation` artık
davet id'si plugin'in kendi opak id üretecinden gelmediğinde doğrulanmış bir e-posta talep
ediyor. Kurul'un `advanced.database.generateId`'si her tablo için — davetler dahil —
`uuidv7()` kullanıyor, dolayısıyla "built-in" sayılmıyor ve sağlamlaştırılmış varsayılan bize
otomatik olarak uygulanırdı — ancak `apps/api/src/auth/auth.ts`,
`requireEmailVerificationOnInvitation: false`'ı açıkça set ediyor, ki bu varsayılanın önüne
geçer ve açığı açık tutar.

Bu override bir gözden kaçırma değildi. Yazıldığı sırada `sendInvitationEmail` bir no-op'tu
(e-posta gönderimi MVP ötesine ertelenmişti — bkz. [ROADMAP.md](../../../ROADMAP.md)) ve
`emailAndPassword.requireEmailVerification` zaten `false`'tu, dolayısıyla hiçbir kullanıcı
doğrulanmış bir duruma ulaşamıyordu; davet kontrolünü olduğu gibi açmak her daveti güvensiz
olmaktan çıkarıp kalıcı olarak kabul edilemez hale getirirdi. better-auth bağımlılığını tek
başına yükseltmek burada GHSA-fmh4-wcc4-5jm3'ü kapatamaz — önce e-posta gönderimi var olmalı,
yoksa düzeltme bir bozuk durumu bir başkasıyla takas eder.

## Karar

SMTP tabanlı e-posta gönderimi gönder (`apps/api/src/mail/`, `nodemailer`, yalnızca
`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_SECURE` / `MAIL_FROM` ortam
değişkenleri üzerinden yapılandırılır — sağlayıcıya özel bir API değil, böylece self-hosted bir
deployment hiçbir zaman bir vendor'a bağımlı olmaz) ve bunu başlangıçta tek bir amaç için
kullan: `requireEmailVerificationOnInvitation: true`'nun ihtiyaç duyduğu doğrulama e-postası.
Normal kayıt ve giriş etkilenmez —
`emailAndPassword.requireEmailVerification` `false` kalır. Yalnızca davet-kabul yolu artık
doğrulanmış bir e-posta adresi gerektirir.

## Gerekçe

- Açık özellikle _davet_ kabulünde yaşıyor — gerçek davet edileni önce kayıt olmaya zorlayan
  bir saldırgan yarışı. Kayıt ve girişte eşdeğer bir yarış yok: bir hesap kendi e-postasını
  oluşturulduğu andan itibaren sahiplenir, onu iddia etmeye çalışan başka bir şey yok. Yalnızca
  açık olan yolu düzeltmek, tehdit modelinin gerektirmediği alakasız, daha yüksek sürtünmeli
  bir değişiklikten (her kayıtta zorunlu doğrulama) kaçınır.
- Sağlayıcıya özel bir SDK (Resend, SendGrid, Postmark, …) değil SMTP + ortam değişkenleri,
  çünkü Kurul AGPL ve self-hosted: bir sağlayıcı API key'i, yazılımı çalıştırmak için bir
  self-hoster'ın oluşturması ve ödemesi gereken bir hesap daha demek. Zaten çalıştırdıkları
  herhangi bir mail sunucusu SMTP konuşur.
- `SMTP_HOST` set edilmediğinde no-op fallback, henüz mail yapılandırmaya hazır olmayanlar için
  mevcut boot davranışını korur — uygulama eksik bir `BETTER_AUTH_SECRET`'te olduğu gibi sert
  başarısız olmaz — ama bu kolaylığın keskin bir ucu var, production'da keşfedilmeye
  bırakılmak yerine aşağıda açıkça belirtiliyor.

## Sonuçlar

- Mevcut kullanıcılar etkilenmez: hiçbir hesap geriye dönük olarak doğrulama yapmaya
  zorlanmaz, ve normal giriş asla `emailVerified`'ı kontrol etmez.
- **SMTP'yi hiç yapılandırmayan bir deployment artık davetlerini kabul ettiremez.** Bu, bir
  güvenlik açığını sert bir operasyonel gereksinimle takas eder, sessiz bir regresyon değil:
  `.env.example`, `SMTP_*` değişkenlerini ve onları boş bırakmanın sonucunu belgeler;
  `docker-compose.yml`, onları `api` servisine varsayılan bir host olmadan geçirir, yani
  production bilinçli olarak opt-in yapmalıdır; `docker-compose.dev.yml` bir Mailpit
  container'ı gönderir, böylece lokal geliştirme hiçbir zaman kendisi engellenmez (bkz.
  [development.md](../development.md#smtp-ve-mailpit)).
- GHSA-fmh4-wcc4-5jm3'ü kapatmak, `apps/api/src/auth/auth.ts` içindeki
  `requireEmailVerificationOnInvitation: false`'ın mail modülü çıktığında kaldırılması demek —
  bu flag bugün yalnızca e-posta gönderimi olmadan onu açmanın her daveti bozacağı için var, ve
  bu ADR'nin kaldırdığı ön koşul tam olarak bu.
- `apps/api/src/mail/`, davet akışının artık runtime'da ihtiyaç duyduğu küçük bir bağımlılık
  haline geliyor; bozuk bir SMTP yapılandırması "API çalışmıyor" yerine "davetler başarısız
  oluyor"a düşer — başlangıçta ona dokunan tek kod yolları davet gönderme ve davet kabuldür.
- Gelecekteki bildirim e-postaları (mention'lar, due-soon hatırlatmaları — bkz.
  [ROADMAP.md — MVP ötesi](../../../ROADMAP.md#beyond-mvp)) aynı modülü ve aynı ortam değişkenlerini
  yeniden kullanabilir, ileride ikinci bir mail yolu eklemek yerine.

## Değerlendirilen Alternatifler

| Alternatif                                                                                    | Neden değil                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sağlayıcıya özel e-posta API'si (Resend, SendGrid, Postmark)                                  | Entegre etmesi daha hızlı, ama self-hosted bir AGPL ürünü ücretli bir dış hesaba bağlar — stack'in geri kalanının hedeflediği deployment modelinin tam tersi                       |
| Her yerde doğrulanmış e-posta zorunlu kıl (`emailAndPassword.requireEmailVerification: true`) | Gerçek açığın kapsadığından fazlasını kapatır; yalnızca davet yolunda var olan bir yarış durumu için her kayda sürtünme ekler                                                      |
| better-auth'u yükselt ve `false` override'ını kaldır, e-posta göndermeden                     | Tek başına çalışmaz — `sendInvitationEmail`'in hâlâ gönderecek hiçbir şeyi yok, dolayısıyla hiçbir hesap `emailVerified: true`'ya ulaşamaz ve her davet kalıcı olarak takılı kalır |
