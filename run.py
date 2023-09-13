from market import app

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8081)#'173.219.167.170', port=8081)

"""
TODO:

- fix page size to remove side scrolling
- Show fees on purchase page
- show cash back due to inconsistent fees
- reinvest cash back setting for large enough orders
"""
