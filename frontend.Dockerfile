FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

COPY *.html /usr/share/nginx/html/

COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY images/ /usr/share/nginx/html/images/
COPY fonts/ /usr/share/nginx/html/fonts/
COPY videos/ /usr/share/nginx/html/videos/

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]