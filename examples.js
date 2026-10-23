// Example notebooks for NGN 112, following the code shown in the lecture slides.
(() => {
  const clean = (strings, values) => String.raw({ raw: strings }, ...values).replace(/\\`/g, '`').replace(/^\n/, '').trimEnd();
  const code = (strings, ...values) => ({ type: 'code', source: clean(strings.raw, values) });
  const md = (strings, ...values) => ({ type: 'markdown', source: clean(strings.raw, values) });

  window.PYLAB_EXAMPLES = [
    {
      key: 'welcome',
      title: 'My notebook',
      cells: [
        md`
# Welcome to NGN 112 PyLab 👋

This works like **Google Colab**, but Python runs right here in your browser. Nothing to install.

* Click a code cell and press **Shift + Enter** (or the ▶ button) to run it.
* The output appears directly under the cell.
* Variables are remembered from one cell to the next.
* Open the lecture examples from the **Examples** menu.`,
        code`
print("Hello, NGN 112!")
x = 5
y = 3
x + y`,
        code`
name = input("Enter your name: ")
print("Nice to meet you,", name)`,
        code`
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(0, 2 * np.pi, 100)
plt.figure(figsize=(6, 3))
plt.plot(x, np.sin(x), label="sin(x)")
plt.plot(x, np.cos(x), label="cos(x)")
plt.legend()
plt.title("My first plot")
plt.show()`,
        md`Write your own code below. 👇`,
        code``,
      ],
    },
    {
      key: 'python-basics',
      title: 'Lecture 2 · Python Basics',
      subtitle: 'Variables, types, operators, input(), math',
      cells: [
        md`
# Introduction to Python: Basics
Run each cell with **Shift + Enter** and change the values to experiment.`,
        md`## Variables and data types`,
        code`
age = 20            # int
height = 1.75       # float
name = 'Sara'       # str
is_student = True   # bool
print(type(age), type(height), type(name), type(is_student))`,
        md`## Arithmetic operators`,
        code`
a = 17
b = 5
print('a + b  =', a + b)
print('a - b  =', a - b)
print('a * b  =', a * b)
print('a / b  =', a / b)    # true division
print('a // b =', a // b)   # floor division
print('a % b  =', a % b)    # remainder
print('a ** b =', a ** b)   # power`,
        md`## Strings`,
        code`
course = 'NGN 112'
print(course.lower(), course.upper(), len(course))
print(course[0:3])                  # slicing
print(f'Welcome to {course}!')      # f-string`,
        md`
## The input() function
\`input()\` always returns a **string**. Cast it with \`int()\` or \`float()\` to do arithmetic.`,
        code`
# The input function returns a string
x = input("Enter a value for x: ")   # enter 100
y = input("Enter a value for y: ")   # enter 200
# here x and y are treated as strings
print('x + y =', x + y)`,
        code`
x = int(input("Enter an int value for x: "))   # enter 100
y = int(input("Enter an int value for y: "))   # enter 200
# here x and y are treated as ints
print('x + y =', x + y)`,
        md`## The math module`,
        code`
import math
print(math.pi)
print(math.sqrt(16))
print(math.floor(3.7), math.ceil(3.2))
print(math.pow(2, 10))`,
        md`## Lists`,
        code`
grades = [90, 88, 84, 30, 100]
grades.append(75)
print(grades)
print('first:', grades[0], 'last:', grades[-1])
print('count:', len(grades), 'max:', max(grades), 'sum:', sum(grades))`,
      ],
    },
    {
      key: 'decisions-loops',
      title: 'Lecture 3 · Decision Making & Repetition',
      subtitle: 'if / elif / else, for, while, range',
      cells: [
        md`# Decision Making and Repetition`,
        md`## if / elif / else`,
        code`
score = float(input('Enter your score: '))
if score >= 90:
    grade = 'A'
elif score >= 80:
    grade = 'B'
elif score >= 70:
    grade = 'C'
else:
    grade = 'F'
print('Your grade is', grade)`,
        md`## Example 1: for loop`,
        code`
grades = [90, 88, 84, 30, 100]
# find avg using built-in functions
avg = sum(grades) / len(grades)
print('avg = ', avg)
# find avg using a for loop
sum_grades = 0
for grade in grades:
    sum_grades = sum_grades + grade
# end of loop
avg = sum_grades / len(grades)
print('avg = ', avg)`,
        md`## Example 2: nested for loops`,
        code`
cars = ["Toyota", "Lexus", "BMW", "Tesla"]
colors = ["red", "white", "black", "blue"]
for x in cars:
    for y in colors:
        print(x, y)`,
        md`## range()`,
        code`
for number in range(1, 10, 2):   # range(from, to-1, step)
    print(number, end=' ')`,
        code`
# print out the multiplication table
for i in range(1, 11):          # outer loop
    for j in range(1, 11):      # inner loop
        print(i, '*', j, '=', i * j)
    print('---------')`,
        md`## while loops, break and continue`,
        code`
count = 5
while count > 0:
    print('Countdown:', count)
    count = count - 1
print('Lift off!')`,
        code`
# Keep asking until the user types a positive number
while True:
    n = int(input('Enter a positive number: '))
    if n > 0:
        break
    print('That is not positive, try again.')
print('Factorial of', n, 'is', __import__('math').factorial(n))`,
        md`> **Tip:** if a loop never ends, press the ■ **Stop** button in the toolbar.`,
      ],
    },
    {
      key: 'numpy-pandas',
      title: 'Lecture 4 · NumPy and Pandas',
      subtitle: 'Arrays, statistics, DataFrames, read_csv',
      cells: [
        md`# Introduction to NumPy and Pandas`,
        md`## NumPy arrays`,
        code`
import numpy as np
arr = np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
print(arr * 2)
print(arr.reshape(3, 4))
print('mean =', np.mean(arr), ' std =', np.std(arr))`,
        code`
grades = np.array([[87, 96, 70], [100, 87, 90], [94, 77, 90], [100, 81, 82]])
print('Average per student:', grades.mean(axis=1))
print('Average per exam:   ', grades.mean(axis=0))
print('Sorted (axis=0):\n', np.sort(grades, axis=0))
print('Transposed:\n', np.transpose(grades))`,
        code`
array = np.array(['apple', 'apple', 'banana', 'orange', 'apple', 'apple', 'banana'])
values, frequencies = np.unique(array, return_counts=True)
max_index = np.argmax(frequencies)
print('Most frequent:', values[max_index], 'appears', frequencies[max_index], 'times')`,
        md`## Pandas DataFrames`,
        code`
import pandas as pd
df = pd.DataFrame({
    'Name': ['Ali', 'Mona', 'Omar', 'Lina'],
    'Exam1': [87, 100, 94, 100],
    'Exam2': [96, 87, 77, 81],
})
df['Average'] = (df['Exam1'] + df['Exam2']) / 2
df`,
        code`
df.describe()`,
        code`
df[df['Average'] > 90]`,
        md`
## Reading a data file
\`iris.data\` is already in the **Files** panel on the left (like a file you uploaded to Colab).`,
        code`
data = pd.read_csv('iris.data', header=None)
# data = pd.read_csv('http://archive.ics.uci.edu/ml/machine-learning-databases/iris/iris.data', header=None)
# You can then add column headers
data.columns = ['sepal_length', 'sepal_width', 'petal_length', 'petal_width', 'class']
data.head()`,
        code`
print(data.shape)
print(data['class'].value_counts())
data.groupby('class').mean()`,
      ],
    },
    {
      key: 'visualization',
      title: 'Lecture 5 · Data Summaries & Visualization',
      subtitle: 'Five-number summary, scaling, seaborn plots',
      cells: [
        md`# Data Summaries and Visualization`,
        md`## Numerical summaries`,
        code`
import numpy as np
X = np.array([210, 210, 260, 210, 260, 210, 125, 140])
print('The mean of X is', np.mean(X))
print('The median of X is', np.median(X))
print('The standard deviation of X is', np.std(X))
Range = np.max(X) - np.min(X)
print('Range =', Range)`,
        code`
# Five-number summary
n1 = np.min(X)
n2 = np.percentile(X, 25)
n3 = np.percentile(X, 50)
n4 = np.percentile(X, 75)
n5 = np.max(X)
print('Min, Q1, Median, Q3, Max =', n1, n2, n3, n4, n5)
z = (X - np.mean(X)) / np.std(X)
print('z-scores:', np.round(z, 2))`,
        md`## Pre-processing with scikit-learn`,
        code`
from sklearn import preprocessing
X_train = np.array([[1., -1., 2.], [2., 0., 0.], [0., 1., -1.]])

Z_score_scaler = preprocessing.StandardScaler()   # 1) create scaler
Z_score_scaler.fit(X_train)                       # 2) train (fit) scaler
X_scaled = Z_score_scaler.transform(X_train)      # 3) normalize data
print('means per column:', Z_score_scaler.mean_)
print('variances per column:', Z_score_scaler.var_)
print(X_scaled)

min_max_scaler = preprocessing.MinMaxScaler()
min_max_scaler.fit(X_train)
print(min_max_scaler.transform(X_train))`,
        code`
LabelEnc = preprocessing.LabelEncoder()
labels = LabelEnc.fit_transform(['red', 'green', 'blue', 'green', 'red'])
print(labels, LabelEnc.classes_)`,
        md`## Visualizing the iris dataset`,
        code`
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

data = pd.read_csv('iris.data', header=None)
data.columns = ['sepal length', 'sepal width', 'petal length', 'petal width', 'species']
print(data.describe())`,
        code`
plt.figure(figsize=(6, 4))
sns.histplot(data=data, x='petal length', hue='species', kde=True)
plt.title('Histogram of petal length')
plt.show()`,
        code`
plt.figure(figsize=(6, 4))
sns.boxplot(data=data, x='species', y='sepal length')
plt.show()`,
        code`
plt.figure(figsize=(6, 4))
sns.scatterplot(data=data, x='petal length', y='petal width', hue='species')
plt.show()`,
        code`
sns.pairplot(data, hue='species', height=1.8)
plt.show()`,
        code`
plt.figure(figsize=(5, 4))
sns.heatmap(data.drop(columns='species').corr(), annot=True, cmap='coolwarm')
plt.title('Correlation matrix')
plt.show()`,
        code`
df = pd.DataFrame({'Products': ['A', 'B', 'C', 'D'], 'Units Sold': [120, 90, 150, 60]})
plt.figure(figsize=(5, 3))
sns.barplot(data=df, x='Products', y='Units Sold')
plt.show()`,
      ],
    },
    {
      key: 'classification-regression',
      title: 'Lecture 6 · Classification & Regression',
      subtitle: 'Linear regression, SVR, DT, KNN, Naive Bayes, SVC',
      cells: [
        md`# Classification and Regression Tasks`,
        md`## Example 1: Simple regression (student scores)`,
        code`
import pandas as pd
# Loading dataset
stud_scores = pd.read_csv('student_scores.csv')
# Print the first 5 rows
print(stud_scores.head())
print(stud_scores.describe())`,
        code`
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, r2_score
import numpy as np

X = stud_scores[['Hours']]
y = stud_scores['Scores']
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=0)

regressor = LinearRegression()
regressor.fit(X_train, y_train)
y_pred = regressor.predict(X_test)

print('Coefficients:', np.round(regressor.coef_, 2), ' Intercept:', round(regressor.intercept_, 2))
print('Predictions:', np.round(y_pred, 2))
print('MSE =', round(mean_squared_error(y_test, y_pred), 2), ' R2 =', round(r2_score(y_test, y_pred), 3))`,
        code`
y_pred_all = regressor.predict(X)
plt.scatter(X, y, label='Actual')
plt.plot(X, y_pred_all, color='red', label='Regression line')
plt.xlabel('Hours studied')
plt.ylabel('Score')
plt.legend()
plt.show()`,
        md`## Example 2: Multiple regression (California housing)`,
        code`
from sklearn.datasets import fetch_california_housing
housing_data = fetch_california_housing()   # load the dataset
X = housing_data.data      # feature matrix
y = housing_data.target    # response vector
print('Feature names: ', housing_data.feature_names)
print('Target names: ', housing_data.target_names)
print('Shape of dataset', X.shape)`,
        code`
X_train, X_test, y_train, y_test = train_test_split(X, y)
regressor = LinearRegression()
regressor.fit(X_train, y_train)
y_pred = regressor.predict(X_test)
print("Coefficients:\n", np.round(regressor.coef_, 2))
print('R2 score =', round(r2_score(y_test, y_pred), 3))`,
        md`## Support Vector Regression (diabetes dataset)`,
        code`
from sklearn.datasets import load_diabetes
from sklearn.svm import SVR
X, y = load_diabetes(return_X_y=True)
X_train, X_test, y_train, y_test = train_test_split(X, y, random_state=1)
svr = SVR(kernel='linear', C=100)
svr.fit(X_train, y_train)
print('SVR R2 =', round(r2_score(y_test, svr.predict(X_test)), 3))`,
        md`## Classification: the iris dataset`,
        code`
from sklearn import preprocessing, metrics
from sklearn.tree import DecisionTreeClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.naive_bayes import GaussianNB
from sklearn.svm import SVC, LinearSVC
from sklearn.metrics import accuracy_score

df = pd.read_csv('iris.data', header=None)
df.columns = ['sepal length', 'sepal width', 'petal length', 'petal width', 'species']
LblEncoder = preprocessing.LabelEncoder()
df['species'] = LblEncoder.fit_transform(df['species'])

X = df[['sepal length', 'sepal width']].values
y = df['species'].values
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=1)

classifiers = {
    'DT (max_depth = 3)': DecisionTreeClassifier(max_depth=3),
    'KNN': KNeighborsClassifier(n_neighbors=5),
    'Naive Bayes': GaussianNB(),
    'Linear SVC': LinearSVC(),
    'SVM (poly)': SVC(kernel='poly'),
    'SVM (RBF)': SVC(kernel='rbf'),
}
for name, clf in classifiers.items():
    clf.fit(X_train, y_train)
    print(f'{name:20s} accuracy = {accuracy_score(y_test, clf.predict(X_test)):.2f}')`,
        md`### Decision boundaries (mlxtend)`,
        code`
from mlxtend.plotting import plot_decision_regions
clf = DecisionTreeClassifier(max_depth=3)
clf.fit(X_train, y_train)
plt.figure()
plot_decision_regions(X_train, y_train, clf)
plt.xlabel('Sepal Length')
plt.ylabel('Sepal Width')
plt.show()`,
        code`
from sklearn import tree
plt.figure(figsize=(10, 5))
tree.plot_tree(clf, feature_names=['sepal length', 'sepal width'], class_names=list(LblEncoder.classes_), filled=True)
plt.show()`,
      ],
    },
    {
      key: 'neural-networks',
      title: 'Lecture 7 · Neural Networks',
      subtitle: 'MLPClassifier and MLPRegressor',
      cells: [
        md`# Neural Networks with scikit-learn`,
        md`## NN classification`,
        code`
from sklearn.datasets import make_classification
from sklearn.model_selection import train_test_split
X, y = make_classification(n_samples=100, random_state=1)
X_train, X_test, y_train, y_test = train_test_split(X, y, random_state=1)

# Initializing a neural network (NN) classifier
from sklearn.neural_network import MLPClassifier
clf = MLPClassifier(random_state=1, max_iter=300)
# clf = MLPClassifier(hidden_layer_sizes=(5,20), random_state=1, max_iter=10000, activation='logistic')

# Training/fitting the model
clf.fit(X_train, y_train)
# Using the model for prediction
y_predict = clf.predict(X_test)
# Evaluating the model performance
from sklearn import metrics
acc = metrics.accuracy_score(y_test, y_predict)
print("Accuracy score is ", acc)`,
        md`## NN regression`,
        code`
from sklearn.datasets import make_regression
from sklearn.neural_network import MLPRegressor
from sklearn.metrics import mean_squared_error, r2_score
X, y = make_regression(n_samples=200, random_state=1)
X_train, X_test, y_train, y_test = train_test_split(X, y, random_state=1)
regr = MLPRegressor(random_state=1, max_iter=2000)
regr.fit(X_train, y_train)
y_pred = regr.predict(X_test)
print('MSE =', round(mean_squared_error(y_test, y_pred), 2))
print('R2  =', round(r2_score(y_test, y_pred), 3))`,
        md`## Case study: iris with an MLP`,
        code`
import pandas as pd
import matplotlib.pyplot as plt
df = pd.read_csv('iris.data', header=None)
X = df.iloc[:, :4].values
y = df.iloc[:, 4].values
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=1)

nn = MLPClassifier(hidden_layer_sizes=(10, 5), max_iter=2000, random_state=1)
nn.fit(X_train, y_train)
print('MLP accuracy:', metrics.accuracy_score(y_test, nn.predict(X_test)))

plt.plot(nn.loss_curve_)
plt.xlabel('Iteration')
plt.ylabel('Training loss')
plt.title('Learning curve')
plt.show()`,
      ],
    },
  ];
})();
