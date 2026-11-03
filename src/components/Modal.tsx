import type { ReactNode } from "react";

import { CATEGORY_LABEL } from "../types";
import type { Category } from "../types";

type ModalProps = {
  eyebrow: string;
  title: string;
  onClose?: () => void;
  size?: "normal" | "small";
  children: ReactNode;
};

export function Modal({ eyebrow, title, onClose, size = "normal", children }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className={`modal modal--${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          {onClose ? (
            <button type="button" className="ghost-button" onClick={onClose}>
              閉じる
            </button>
          ) : null}
        </div>
        {children}
      </section>
    </div>
  );
}

type CategoryToggleProps = {
  value: Category;
  onChange: (value: Category) => void;
  disabled?: boolean;
};

export function CategoryToggle({ value, onChange, disabled }: CategoryToggleProps) {
  return (
    <div className="segmented" role="radiogroup">
      {(["bgm", "se"] as const).map((category) => (
        <button
          key={category}
          type="button"
          role="radio"
          aria-checked={value === category}
          className={`segmented__item segmented__item--${category}${
            value === category ? " segmented__item--active" : ""
          }`}
          onClick={() => onChange(category)}
          disabled={disabled}
        >
          {CATEGORY_LABEL[category]}
        </button>
      ))}
    </div>
  );
}
