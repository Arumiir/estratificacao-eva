create table if not exists grades (
  date text not null,
  key text not null,
  config jsonb not null,
  primary key (date, key)
);
