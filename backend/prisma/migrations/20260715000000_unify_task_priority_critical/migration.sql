-- Görev önceliğini ticket önceliğiyle birleştir: 'urgent' -> 'critical'
--
-- Aynı kavram iki farklı sözcükle ifade ediliyordu: ticket'larda 'critical',
-- görevlerde 'urgent'. Ticket'lar çekirdek alan olduğu için 'critical' esas
-- alındı ve görevler ona hizalandı.
--
-- Şemada enum yok (priority düz String), bu yüzden tip değişikliği gerekmez —
-- yalnızca mevcut satırlar güncellenir. İleri yönlü: yeni kayıtlar zaten
-- 'critical' yazacak (tasks.routes.ts zod şeması).
UPDATE "tasks" SET "priority" = 'critical' WHERE "priority" = 'urgent';
