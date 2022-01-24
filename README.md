# FlaskProject
# Math site

## Table of contents
# description
# installation
# other_notes
# TODO


# description
This site is a site to allow you to work through math problems easily while showing your work on the way, and it will auto-check you every step of the way to let you know if you messed up.

# installation
# virtual environment reccomended because there is a lot of packages
# cd to the main directory MathDocs first

1. pip install virtualenv

2. virtualenv .

#may vary depending on OS
3. source bin/activate

#install all python dependencies
4. pip install -r requirements.txt

5. python3 run.py

- the link to the site will be in the output of the command or go to http://localhost:1194
- if you want to share it locally over your LAN, then open run.py and change the host='localhost' to host='0.0.0.0' then get the url from flask's output
- the url will be your local IP. this changes often so I believe it's generally ok to share it.


- to host it publicly, you will need to port forward your local ip with the port 1194 in your router's settings, then you will be able to access your site from any computer if you go to the url which will be your http://publicIP:1194


# other_notes
polyfill is to make your website more accessible to older browsers, talked about in the last video on the playlist above (FCC jQuery series)


# TODO - append notes here with `echo 'note' >> README.md`

add unit tests to make it obvious if a change you made broke anything: https://www.freecodecamp.org/news/devops-engineering-course-for-beginners/
measure code coverage in the tests to see what you didn't test
