# 0003. Frontend Stack: Next.js + Tailwind + shadcn/ui + @dnd-kit + Recharts

**Durum:** Kabul edildi
**Tarih:** 2026-08-08
**Güncellendi:** 2026-08-08 — @dnd-kit gerekçesi registry ile çelişiyordu ve dürüstçe yeniden yazıldı; kaynaksız Recharts bundle rakamı yerine bağımlılık yüzeyi kondu.

> 🌐 [English (canonical)](../../decisions/0003-frontend-stack.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Frontend; interaktif bir kanban board'u (drag-and-drop ile yeniden sıralama), stillendirilmiş bir component sistemini ve grafikli bir dashboard'u render etmeli, aynı zamanda solo/küçük ekip kod tabanının bakımını yapabileceği kadar hafif kalmalı.

## Karar

**Next.js 16 (App Router)** + **Tailwind CSS** + **shadcn/ui** + **@dnd-kit** + **Recharts**.

## Gerekçe

- `react-beautiful-dnd` deprecated — Atlassian bakımından çekildi, dolayısıyla yeni iş için uygulanabilir bir seçim değil.
- **@dnd-kit, klasik hat** (`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0). MIT, ~6 KB core, erişilebilir (klavye ve ekran okuyucu desteği), framework-agnostik ve en yaygın kullanılan React drag-and-drop kütüphanesi.
- **Bilinçli olarak kaydedilmiştir: bu hat donmuş durumda, aktif bakımda değil.** Klasik paketler Aralık 2024'ten beri hiçbir sürüm çıkarmadı ve dokümantasyon sitesinin repository'si Şubat 2026'da arşivlendi. Bakım çabası yeni nesil bir yeniden yazıma (`@dnd-kit/react`) kaydı; bu hat hâlâ 1.0 öncesi, farklı bir API'ye sahip ve burada **benimsenmiyor**. Donmuş bir kütüphane bozuk bir kütüphane değildir — 50–200 kartlık bir board için "sürüm yok" makul biçimde "bitti" anlamına gelebilir — ama karar bu bilinerek veriliyor, buna rağmen değil.
- **Alternatif aktif bakımda ve yine de kaybediyor.** Atlassian'ın `pragmatic-drag-and-drop`'u (2.0.x, Apache-2.0) düzenli sürüm çıkarıyor, ama collision detection'ın elle yazılmasını gerektiriyor ve v2'si ince bir upgrade dokümantasyonuyla geldi. Solo bir maintainer için, upgrade sancısı olmayan sabit bir bağımlılık, özel collision kodu gerektiren aktif sürümlü bir bağımlılıktan daha değerli; sabitlenmiş-ve-donmuş risk etrafından dolaşamayacağımız bir bug — bu, kalıcı bir bakım vergisinden daha küçük ve daha görünür bir risk.
- Sürümler **tam olarak pinlenir** (`^` yok), çünkü "latest" hiçbir fix garantisi taşımıyor.
- **Recharts**, çoğu React dashboard'u için en güvenli varsayılan: güçlü ekosistem benimsenmesi, anlaşılır bir component API'si, SVG rendering, shadcn/ui ile iyi uyum, MIT lisanslı. En hafif seçenek değil, ve kaydetmeye değer maliyet bir byte sayısı değil bağımlılık yüzeyi: v3, `@reduxjs/toolkit`, `react-redux`, `immer` ve `victory-vendor`'ı (d3) runtime bağımlılığı olarak deklare ediyor, yani başka hiçbir state kütüphanesi olmayan bir uygulamaya Redux Toolkit'i sokuyor. Grafik sayısı büyürse, bir bundle bütçesi daralırsa veya o bağımlılık grafiği uygulama seviyesindeki state seçimleriyle çatışırsa Canvas tabanlı bir kütüphane (Chart.js, Apache ECharts) yeniden değerlendirilmeli.

## Sonuçlar

- Kendimiz klavye desteği inşa etmeden, kutudan çıktığı gibi erişilebilir drag-and-drop.
- Tailwind + shadcn/ui üzerinden tutarlı görsel dil, tek seferlik stillendirmeyi azaltıyor.
- Recharts'ın sade API'siyle dashboard'lar hızlıca yayına alınıyor.
- Board etkileşimleri daha karmaşıklaştıkça (nested sortable'lar, çok kolonlu drag) `@dnd-kit`'in collision detection'ı özel ayarlama gerektirebilir — ve klasik hat için gelecek bir upstream fix yok, dolayısıyla her ayarlama bize ait.
- Etrafından dolaşamayacağımız bir `@dnd-kit` bug'ı bu kararın kabul ettiği başarısızlık modu. **Yeniden değerlendirme tetikleyicisi: Faz 4'te**
  (MVP yol haritasının Faz 4'ü; checklist'i artık yalnızca git geçmişinde), board etkileşimi gerçekten inşa edildiğinde, ya da böyle bir bug daha erken ortaya çıkarsa veya `@dnd-kit/react` 1.0'a ulaşırsa daha erken. Göç hedefi
  `pragmatic-drag-and-drop`, "collision detection yaz" olarak maliyetlendirildi, "board'u yeniden mimarile" olarak değil.
- **Faz 4 yeniden değerlendirme (2026-08-09):** klasik `@dnd-kit` çok kolonlu board'u taşıdı; bloklayıcı çıkmadı — **pin'li klasik hat korunuyor**. Yalnızca donmuş hat bir bug'ı sonraki etkileşimi engellerse veya `@dnd-kit/react` net göç yoluyla 1.0'a ulaşırsa yeniden bak.
- Recharts'ın bağımlılık yüzeyi analitik özellikler genişledikçe yeniden ele alınmalı — bu bir gözden kaçırma değil, bilinçli bir "sonra tekrar bak" trade-off'u.

## Değerlendirilen Alternatifler

| Alternatif                | Neden değil                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| react-beautiful-dnd       | Deprecated; Atlassian bakımından çekildi                                                                                                                                                                                                    |
| pragmatic-drag-and-drop   | Aktif bakımda (2.0.x, Apache-2.0) ve belirlenmiş fallback, ama collision detection'ın elle yazılmasını gerektiriyor ve v2'si ince bir upgrade dokümantasyonuyla geldi — yalnızca @dnd-kit bizi engellerse kabul edilecek kalıcı bir maliyet |
| Chart.js / Apache ECharts | Canvas tabanlı, çok büyük veri setleri için daha iyi, ama entegrasyonu daha ağır ve şu an shadcn/ui ile daha az idiomatic                                                                                                                   |
