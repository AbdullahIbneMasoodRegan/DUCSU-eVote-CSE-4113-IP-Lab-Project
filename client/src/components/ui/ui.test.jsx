// M3 — UI kit: Modal, Stepper, FormField, Avatar.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { Avatar, FormField, Modal, Stepper } from './index.js';

function ModalHarness({ onClose = () => {} }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Modal open={open} onClose={() => { onClose(); setOpen(false); }} title="Confirm" footer={<button>OK</button>}>
        <p>Body text</p>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('is hidden until opened, labelled by its title, and closes with Escape', () => {
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Body text')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves focus inside, returns it to the opener, and has a labelled close button', () => {
    render(<ModalHarness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside the dialog', () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const ok = screen.getByRole('button', { name: 'OK' });
    ok.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});

describe('Stepper', () => {
  it('announces the step and marks the current one', () => {
    render(<Stepper steps={['Post', 'Photo', 'Review']} current={1} />);
    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument();
    const current = screen.getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveTextContent('Photo');
  });
});

describe('FormField', () => {
  it('connects the label, hint and error to the control', () => {
    render(<FormField label="Bio" as="textarea" hint="Max 10" error="Required" required value="" onChange={() => {}} />);
    const box = screen.getByLabelText(/Bio/);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    const described = box.getAttribute('aria-describedby').split(' ');
    expect(described).toHaveLength(2);
    expect(document.getElementById(described[0])).toHaveTextContent('Max 10');
    expect(document.getElementById(described[1])).toHaveTextContent('Required');
  });

  it('supports a render-prop control', () => {
    render(<FormField label="Name">{(p) => <input {...p} type="text" />}</FormField>);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });
});

describe('Avatar', () => {
  it('shows initials without a photo and an image with one', () => {
    const { rerender } = render(<Avatar name="Rahim Uddin" />);
    expect(screen.getByText('RU')).toBeInTheDocument();
    rerender(<Avatar name="Rahim Uddin" src="/api/candidates/1/photo" alt="Photo of Rahim" />);
    expect(screen.getByAltText('Photo of Rahim')).toHaveAttribute('src', '/api/candidates/1/photo');
  });
});
