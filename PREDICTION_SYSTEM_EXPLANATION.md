# How the Spending Prediction System Works

## Overview
The prediction system uses a **Long Short-Term Memory (LSTM) neural network** to forecast future spending based on historical transaction patterns. It's a deep learning model that can learn temporal patterns in your spending behavior.

---

## Architecture Flow

```
Frontend (React) 
    ↓
Backend API (Node.js/Express)
    ↓
ML Service (Python/FastAPI)
    ↓
LSTM Neural Network (TensorFlow/Keras)
```

---

## Step-by-Step Process

### 1. **Data Collection** (Backend)
When you request predictions, the backend:
- Fetches your last **1,000 transactions** from the database
- Filters only **expenses** (negative amounts)
- Checks if you have at least **15 transactions** (minimum requirement)
- Sends this data to the ML service

**Code Location:** `backend/routes/ai.js` (lines 82-107)

### 2. **Data Preprocessing** (ML Service)
The ML service processes your transaction data:

**a) Data Cleaning:**
- Converts transaction dates to datetime format
- Extracts month and year from dates
- Converts amounts to numeric (handles string values)
- Filters for expenses only (negative amounts → converted to positive)
- Groups transactions by month, year, and category

**b) Data Transformation:**
- Creates a **pivot table** where:
  - Rows = months (year + month combinations)
  - Columns = spending categories (food, transportation, shopping, etc.)
  - Values = total spending per category per month

**Example:**
```
Month/Year  | food | transportation | shopping | ...
2023-01     | 450  | 150           | 200      | ...
2023-02     | 480  | 140           | 350      | ...
2023-03     | 420  | 160           | 180      | ...
```

**Code Location:** `mlservice/prediction_service.py` (lines 228-266)

### 3. **LSTM Model Architecture**

The LSTM (Long Short-Term Memory) model is a type of Recurrent Neural Network (RNN) designed to learn patterns in sequential data.

**Model Structure:**
```
Input Layer: 12 months of historical data
    ↓
LSTM Layer 1: 50 units (with return_sequences=True)
    ↓
Dropout (20% - prevents overfitting)
    ↓
LSTM Layer 2: 50 units (with return_sequences=False)
    ↓
Dropout (20%)
    ↓
Dense Layer: 25 neurons
    ↓
Output Layer: 10 categories (one prediction per category)
```

**Key Parameters:**
- **Sequence Length:** 12 months (the model looks at the last 12 months to predict the next month)
- **Input Features:** Month number (1-12) and Year
- **Output:** Predicted spending for 10 categories:
  - food, transportation, shopping, entertainment, utilities
  - healthcare, education, travel, insurance, other

**Code Location:** `mlservice/prediction_service.py` (lines 135-152)

### 4. **Data Scaling**
Before feeding data to the neural network:
- All values are **normalized** using `MinMaxScaler` (scales values to 0-1 range)
- This ensures all features are on the same scale, which helps the model learn better
- The scaler is saved so predictions can be converted back to real dollar amounts

**Code Location:** `mlservice/prediction_service.py` (lines 123-125, 274)

### 5. **Sequence Creation**
The model needs sequences of 12 months to make predictions:
- Takes the last 12 months of data
- Creates a 3D array: `[1, 12, 2]` (1 sample, 12 time steps, 2 features: month & year)
- This sequence represents the temporal pattern the model will analyze

**Code Location:** `mlservice/prediction_service.py` (lines 277-279)

### 6. **Prediction Generation**
The model:
- Takes the 12-month sequence
- Processes it through the LSTM layers
- Outputs predicted spending for all 10 categories
- Converts predictions back from normalized values to dollar amounts

**Code Location:** `mlservice/prediction_service.py` (lines 281-285)

### 7. **Fallback Mechanism**
If you have **less than 12 months** of data:
- The system uses **simple trend analysis** instead of LSTM
- Calculates average spending per category
- Applies **seasonal multipliers** based on the target month:
  - Shopping: 1.5x in November, 1.8x in December (holiday season)
  - Travel: 1.4x in summer months (June-August)
  - Utilities: 1.2x in winter months (heating costs)
  - etc.

**Code Location:** `mlservice/prediction_service.py` (lines 314-346)

---

## Training Process

### Initial Training
When the service starts for the first time:
- Creates **24 months of sample data** with realistic spending patterns
- Includes seasonal variations (holiday shopping, summer travel, etc.)
- Trains the LSTM model on this sample data
- Saves the trained model, scaler, and category list

**Code Location:** `mlservice/prediction_service.py` (lines 60-104, 154-205)

### Model Training Details
- **Training/Test Split:** 80% training, 20% testing
- **Epochs:** Up to 100 (stops early if no improvement)
- **Batch Size:** 32 samples per batch
- **Optimizer:** Adam (learning rate: 0.001)
- **Loss Function:** Mean Squared Error (MSE)
- **Callbacks:**
  - Early Stopping: Stops if validation loss doesn't improve for 10 epochs
  - Model Checkpoint: Saves the best model during training

### Retraining
The model can be retrained with new user data:
- Combines existing training data with new transactions
- Retrains the model to improve accuracy
- Updates the saved model files

**Code Location:** `mlservice/prediction_service.py` (lines 360-404)

---

## How Predictions Are Calculated

### For Users with 12+ Months of Data (LSTM Method):

1. **Historical Pattern Analysis:**
   - The LSTM analyzes your spending patterns over the last 12 months
   - Learns trends, cycles, and seasonal patterns
   - Identifies relationships between different categories

2. **Temporal Learning:**
   - LSTM cells have "memory" that can remember patterns from earlier months
   - Can detect if spending is increasing, decreasing, or stable
   - Understands that certain months have higher spending (e.g., December)

3. **Feature Extraction:**
   - Month number (1-12) helps the model learn seasonal patterns
   - Year helps track long-term trends
   - Category spending amounts show relationships between categories

4. **Prediction Output:**
   - For each category, the model outputs a predicted dollar amount
   - Confidence score: 0.8 (80%) for LSTM predictions

### For Users with <12 Months of Data (Trend Analysis):

1. **Average Calculation:**
   - Calculates average spending per category from available months
   - Example: If you have 3 months of food spending: $400, $450, $350
   - Average = ($400 + $450 + $350) / 3 = $400

2. **Seasonal Adjustment:**
   - Applies multipliers based on the target month
   - Example: Predicting December shopping
   - Average shopping: $200
   - December multiplier: 1.8x
   - Prediction: $200 × 1.8 = $360

3. **Confidence Score:**
   - 0.6 (60%) for trend analysis predictions
   - Lower confidence because there's less data

---

## Example Calculation

### Scenario: Predicting January 2024 Spending

**User's Historical Data (Last 12 Months):**
```
Month      | Food | Transportation | Shopping
2023-01    | 450  | 150           | 200
2023-02    | 480  | 140           | 180
...
2023-12    | 520  | 160           | 450 (holiday shopping)
```

**LSTM Processing:**
1. Model receives sequence of 12 months
2. Analyzes patterns:
   - Food: Gradually increasing (450 → 520)
   - Shopping: Spike in December (holiday season)
   - Transportation: Relatively stable
3. Predicts January 2024:
   - Food: $500 (continuing upward trend, but post-holiday)
   - Transportation: $155 (stable pattern)
   - Shopping: $220 (returning to normal after holiday spike)

**Output:**
```json
{
  "predictions": [
    {"category": "food", "predicted_amount": 500.00, "confidence": 0.8},
    {"category": "transportation", "predicted_amount": 155.00, "confidence": 0.8},
    {"category": "shopping", "predicted_amount": 220.00, "confidence": 0.8},
    ...
  ],
  "method": "lstm_model",
  "target_month": 1,
  "target_year": 2024
}
```

---

## Key Features

### 1. **Temporal Pattern Recognition**
- Learns from historical sequences, not just averages
- Can detect trends, cycles, and anomalies

### 2. **Multi-Category Prediction**
- Predicts all 10 categories simultaneously
- Understands relationships between categories

### 3. **Adaptive Learning**
- Model can be retrained with new data
- Improves accuracy over time

### 4. **Robust Fallback**
- Works even with limited data
- Uses statistical methods when neural network isn't applicable

### 5. **Seasonal Awareness**
- Built-in seasonal multipliers for common patterns
- LSTM learns user-specific seasonal patterns

---

## Limitations & Considerations

1. **Minimum Data Requirement:** Needs at least 15 transactions to make predictions
2. **Sequence Length:** Requires 12 months of data for LSTM (falls back to trend analysis otherwise)
3. **Category Assumptions:** Assumes standard categories; may not capture unique spending patterns
4. **External Factors:** Doesn't account for one-time events, emergencies, or life changes
5. **Training Data:** Initially trained on synthetic data; improves as real user data is added

---

## Files Involved

- **Backend API:** `backend/routes/ai.js` (lines 74-137)
- **ML Service Endpoint:** `mlservice/main.py` (lines 116-127)
- **Prediction Logic:** `mlservice/prediction_service.py` (entire file)
- **Frontend Display:** `frontend/src/pages/Insights.tsx` (lines 279-335, 495-548)

---

## Summary

The prediction system uses **deep learning (LSTM)** to analyze your spending history and forecast future expenses. It:
- Learns patterns from your transaction history
- Considers temporal sequences (month-to-month trends)
- Handles seasonal variations
- Provides category-specific predictions
- Falls back to statistical methods when data is limited

The model becomes more accurate as it learns from more of your historical data!

