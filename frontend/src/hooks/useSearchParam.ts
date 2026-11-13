import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Tek query-param'ı state gibi kullanır: URL'de değer varsa onu, yoksa
 * `initial`'ı döner; setter URL'i günceller (`replace` — filtre değişimi
 * geçmişe ayrı bir adım olarak yazılmaz).
 *
 * Amaç: liste filtrelerini derin bağlantıya çevirmek. Ticket/Tasks gibi
 * sayfalarda filtre state'i eskiden bileşene gömülüydü; sayfa yenilenince
 * filtreler kayboluyor, ekipte bir view paylaşılamıyordu.
 *
 * `initial`'a eşitlenen değer URL'den SİLİNİR — filtresiz liste kısa ve
 * okunabilir URL üretir.
 */
export function useSearchParam(key: string, initial: string): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = searchParams.get(key) ?? initial;
  const setValue = useCallback(
    (next: string) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === '' || next === initial) params.delete(key);
          else params.set(key, next);
          return params;
        },
        { replace: true },
      );
    },
    [key, initial, setSearchParams],
  );
  return [value, setValue];
}
