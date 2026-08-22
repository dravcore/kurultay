# 0005. Realtime: Socket.io + Redis Adapter

**Durum:** Kabul edildi
**Tarih:** 2026-08-08
**Güncellendi:** 2026-08-08 — "standart seçim" gerekçesine dayanmak yerine, Redis adapter'ın ne zaman gerçekten gerekli olduğunu belirtir.

> 🌐 [English (canonical)](../../decisions/0005-realtime-socketio.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Bir kanban board'unun, bağlı client'lar arasında board/task state'ini senkron tutması gerekiyor. Proje, serverless bir deployment'ı hedeflemek yerine, zaten kendi Postgres ve Redis altyapısını çalıştırıyor.

## Karar

Bare `ws` ve yönetilen realtime servisleri (Ably, Pusher, Liveblocks) yerine, **`@socket.io/redis-adapter`** ile **Socket.io**.

## Gerekçe

- Self-hosted altyapı zaten yerinde olduğundan, Socket.io + Redis adapter standart seçim: `@socket.io/redis-adapter` olayları tüm sunucu süreçlerine dağıtıyor.
- **Adapter, "yatay ölçeklendirme" ifadesinin çağrıştırdığından daha erken gerekli oluyor, bu yüzden ertelenmek yerine baştan bağlanıyor.** Aşamalı runtime planının 2. aşaması ([architecture.md §8](../architecture.md#8-runtime-evrimi)) tek süreci `api`, `ws` ve `worker` rollerine bölüyor. Socket.io gateway'i kendi süreci olur olmaz ve `api` hâlâ domain event'leri yayınlıyorken, bu event'lerin bir süreç sınırını geçmesi gerekiyor — **tek bir `ws` replikasıyla**. Tetikleyici, belki hiç gelmeyecek bir trafik olayı değil, mimarinin zaten planladığı bir deployment şekli değişikliği. Bağlamak kabaca beş satır (`io.adapter(createAdapter(pubClient, subClient))` artı iki Redis client'ı) ve zaten katı bir bağımlılık olan bir Redis'e karşı, dolayısıyla bekleyerek kaçınılacak pek maliyet yok — ve bunu ilk günden yapmak, gateway'i in-process state'ten (modül seviyesinde bir `Map<socketId, workspaceId>`) uzak tutmaya zorluyor; adapter sonradan eklendiğinde asıl kırılan şey de bu.
- **Uyumluluk bilinen-iyi durumdayken erken entegre et.** `@socket.io/redis-adapter` küçük ve özellik açısından tam ama yavaş ilerliyor — son sürümü Mart 2024'te çıktı. Mevcut socket.io 4.8.x hattıyla uyumluluğunun bugün çalıştığı biliniyor; uyumsuzluğu daha sonra, ölçeklendirme baskısı altında keşfetmek, aynı işin pahalı versiyonu.
- Bare `ws`'in overhead'i daha düşük ama oda yönetimini ve otomatik yeniden bağlanmayı elle inşa etmeyi bırakıyor — ikisi de zaten bir kanban board'unun çok-client senaryosu için gerekli, dolayısıyla tasarruf gerçekleşmiyor.
- Yönetilen servisler (Ably, Pusher, Liveblocks) serverless deployment'lara özgü sorunları çözüyor; kendi sunucu altyapımızı uçtan uca işlettiğimiz için burada geçerli değiller.
- **Bilinçli sıralama:** realtime, özellik sırasında son sıraya konuyor (bkz. Faz 1 proje iskeleti, artık yalnızca git geçmişinde) — auth, board'lar, task'lar, task metadata'sı, filtreleme ve dashboard'lardan sonra — çünkü veri akışının önce oturması gerekiyor. Socket'leri erken bağlamak, sonraki her özellik değişikliğinde event kontratlarını güncellemek anlamına gelirdi.

## Sonuçlar

- Oda'lar ve yeniden bağlanma, elle yazılmak yerine kütüphane tarafından hallediliyor.
- Birden fazla sunucu instance'ı gerektiğinde Redis adapter üzerinden kanıtlanmış bir yatay ölçekleme yolu mevcut.
- Vendor lock-in yok, bağlantı başına yönetilen-servis maliyeti yok.
- Redis pub/sub, cache ve kuyruk görevlerinin üzerine işletilmesi gereken başka bir yük deseni haline geliyor.
- Yatay ölçeklendirme hikayesi, tek ve yavaş ilerleyen bir bağımlılığa dayanıyor (`@socket.io/redis-adapter`, 8.3.0, Mart 2024). Daha da yavaşlarsa, yedekler sharded Redis adapter'ı ya da elle yazılmış bir pub/sub fan-out — ikisi de günler süren iş, mimari bir değişiklik değil.
- Realtime'ı sona ertelemek, socket event kontratlarının inşanın geç bir aşamasına kadar gerçek kullanıma karşı doğrulanmadığı anlamına geliyor — o noktada keşfedilen yeniden işlemeler önceki özelliklere geri sıçrayabilir.

## Değerlendirilen Alternatifler

| Alternatif                             | Neden değil                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Bare `ws`                              | Daha düşük overhead, ama zaten gerekli olan oda ve yeniden bağlanma mantığının elle yazılması gerekirdi                                      |
| Ably / Pusher / Liveblocks (yönetilen) | Sahip olmadığımız serverless ölçekleme sorunlarını çözüyor; self-hosted altyapının gereksiz kıldığı maliyet ve harici bir bağımlılık ekliyor |
