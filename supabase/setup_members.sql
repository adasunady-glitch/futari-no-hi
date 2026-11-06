-- ふたりのアカウントを作った後に、メールアドレスと表示名を書き換えて実行する。
insert into public.members (user_id, display_name)
select id, case email
  when 'YOUR_EMAIL@example.com' then 'あなたの名前'
  when 'PARTNER_EMAIL@example.com' then '相手の名前'
end
from auth.users
where email in ('YOUR_EMAIL@example.com', 'PARTNER_EMAIL@example.com');

-- 2行表示されれば成功。
select * from public.members;
