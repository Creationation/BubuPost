-- La derniere image d une video (le tableau de bord) est deposee a cote de
-- la video. Le bucket n acceptait que des videos.
update storage.buckets
set allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/x-m4v', 'image/jpeg', 'image/png']
where id = 'videos';
