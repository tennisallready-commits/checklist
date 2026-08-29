-- Permite personalizar a cor das etiquetas de cada categoria.
alter table public.categories
  add column if not exists color text;

alter table public.categories
  drop constraint if exists categories_color_format_check;

alter table public.categories
  add constraint categories_color_format_check
  check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
