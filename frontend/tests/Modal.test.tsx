// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Gerçek çeviri kataloğu: Modal kapatma etiketi `t('common.close')` ile gelir.
import '../src/i18n/config';
import { Modal } from '../src/components/ui/Modal';

/**
 * Paylaşılan Modal bileşeninin erişilebilirlik sözleşmesi.
 *
 * Bu bileşen 15 kopyalanmış overlay'in yerine geçti; davranışı burada
 * sabitlenir ki sonraki göçler/kullanimlar sözleşmeyi bozmasın:
 * Escape, arka plan tıklaması, Tab odak tuzağı, aria rozetleri ve sayfa
 * kaydırma kilidi.
 */

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('Modal', () => {
  it('open=false iken hiçbir şey çizmez', () => {
    render(<Modal open={false} onClose={() => {}} ariaLabel="Deneme">içerik</Modal>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('dialog rolü, aria-modal ve etiket ile çizilir', () => {
    render(<Modal open onClose={() => {}} ariaLabel="Şirket seç">içerik</Modal>);
    const dialog = screen.getByRole('dialog', { name: 'Şirket seç' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('title verilirse başlık ve kapatma düğmesi çizilir', () => {
    render(<Modal open onClose={() => {}} ariaLabel="Düzenle" title="Personeli düzenle">form</Modal>);
    expect(screen.getByText('Personeli düzenle')).toBeInTheDocument();
    // jsdom'da algılanan dil tarayıcıya göre TR veya EN olabilir.
    expect(screen.getByRole('button', { name: /kapat|close/i })).toBeInTheDocument();
  });

  it('Escape ile kapatır', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} ariaLabel="Deneme">içerik</Modal>);
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('arka plan tıklaması kapatır; closeOnBackdrop=false iken kapatmaz', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<Modal open onClose={onClose} ariaLabel="Deneme">içerik</Modal>);
    await user.click(screen.getByTestId('modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(<Modal open onClose={onClose} ariaLabel="Deneme" closeOnBackdrop={false}>içerik</Modal>);
    await user.click(screen.getByTestId('modal-overlay'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('panel içi tıklama kapatmaz (stopPropagation)', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} ariaLabel="Deneme"><button type="button">panel içi</button></Modal>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'panel içi' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Tab tuzağı odağı kutunun içinde tutar', async () => {
    const user = userEvent.setup();
    render(
      <Modal open onClose={() => {}} ariaLabel="Form">
        <input aria-label="birinci" />
        <input aria-label="ikinci" />
      </Modal>,
    );
    const first = screen.getByLabelText('birinci');
    const second = screen.getByLabelText('ikinci');
    second.focus();
    // Son odaklanabilir öğeden ileri Tab → başa sarar.
    await user.tab();
    expect(first).toHaveFocus();
    // İlk öğeden geriye Tab → sona sarar.
    await user.tab({ shift: true });
    expect(second).toHaveFocus();
  });

  it('açıkken sayfa kaydırma kilitler, kapanınca bırakır', () => {
    const { rerender } = render(<Modal open onClose={() => {}} ariaLabel="Deneme">içerik</Modal>);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Modal open={false} onClose={() => {}} ariaLabel="Deneme">içerik</Modal>);
    expect(document.body.style.overflow).toBe('');
  });
});
