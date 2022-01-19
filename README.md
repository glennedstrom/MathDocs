# FlaskProject

# Math site


# virtual environment reccomended because there is a lot of packages
# cd to the main directory MathDocs first

1. pip install virtualenv

2. virtualenv .

#may vary depending on OS
3. source bin/activate

#install all python dependencies
4. pip install -r requirements.txt

5. python3 run.py

- the link to the site will be in the output of the command or go to localhost:1194
- if you want to share it locally over your LAN, then open run.py and change the host='localhost' to host='0.0.0.0' then get the url from flask's output
- the url will be your local IP. this changes often so I believe it's generally ok to share it.


- to host it publicly, you will need to port forward your local ip with the port 1194, then you will be able to access your site from any computer if you go to the url which will be your publicIP:1194





#other notes
polyfill is to make your website more accessible to older browsers, talked about in the last video on the playlist above (FCC jQuery series)
