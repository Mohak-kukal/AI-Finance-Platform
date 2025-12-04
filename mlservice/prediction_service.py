import os
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Any, Tuple
import joblib
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error
import tensorflow as tf
from tensorflow.keras.models import Sequential, load_model
from tensorflow.keras.layers import LSTM, Dense, Dropout
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint
import warnings
warnings.filterwarnings('ignore')

class PredictionService:
    def __init__(self):
        self.model_path = os.path.join(os.getenv("MODEL_PATH", "../models"), "spend_rnn.h5")
        self.scaler_path = os.path.join(os.getenv("MODEL_PATH", "../models"), "spend_scaler.pkl")
        self.categories_path = os.path.join(os.getenv("MODEL_PATH", "../models"), "categories.pkl")
        
        self.model = None
        self.scaler = None
        self.categories = None
        self.sequence_length = 12  # Use 12 months of data for prediction
        
        self._load_or_initialize_model()
    
    def _load_or_initialize_model(self):
        """Load existing model or initialize new one"""
        try:
            if (os.path.exists(self.model_path) and 
                os.path.exists(self.scaler_path) and 
                os.path.exists(self.categories_path)):
                
                self.model = load_model(self.model_path)
                self.scaler = joblib.load(self.scaler_path)
                self.categories = joblib.load(self.categories_path)
                print("Loaded existing prediction model")
            else:
                self._initialize_model()
                print("Initialized new prediction model")
        except Exception as e:
            print(f"Error loading model: {e}")
            self._initialize_model()
    
    def _initialize_model(self):
        """Initialize new model with sample data"""
        self.scaler = MinMaxScaler()
        self.categories = [
            'food', 'transportation', 'shopping', 'entertainment', 'utilities',
            'healthcare', 'education', 'travel', 'insurance', 'other'
        ]
        
        # Create sample data and train initial model
        sample_data = self._create_sample_data()
        self._train_model(sample_data)
    
    def _create_sample_data(self) -> pd.DataFrame:
        """Create sample spending data for initial model training"""
        # Generate 24 months of sample data
        start_date = datetime.now() - timedelta(days=730)
        dates = [start_date + timedelta(days=i*30) for i in range(24)]
        
        sample_data = []
        np.random.seed(42)
        
        for date in dates:
            for category in self.categories:
                # Generate realistic spending amounts with some randomness
                base_amounts = {
                    'food': 300 + np.random.normal(0, 50),
                    'transportation': 150 + np.random.normal(0, 30),
                    'shopping': 200 + np.random.normal(0, 80),
                    'entertainment': 100 + np.random.normal(0, 40),
                    'utilities': 250 + np.random.normal(0, 20),
                    'healthcare': 80 + np.random.normal(0, 30),
                    'education': 50 + np.random.normal(0, 20),
                    'travel': 120 + np.random.normal(0, 60),
                    'insurance': 200 + np.random.normal(0, 10),
                    'other': 100 + np.random.normal(0, 50)
                }
                
                # Add seasonal variations
                month = date.month
                if month in [11, 12, 1]:  # Holiday season
                    base_amounts['shopping'] *= 1.5
                    base_amounts['entertainment'] *= 1.3
                elif month in [6, 7, 8]:  # Summer
                    base_amounts['travel'] *= 1.4
                    base_amounts['entertainment'] *= 1.2
                
                amount = max(0, base_amounts[category])
                
                sample_data.append({
                    'date': date.strftime('%Y-%m-%d'),
                    'category': category,
                    'amount': amount,
                    'month': date.month,
                    'year': date.year
                })
        
        return pd.DataFrame(sample_data)
    
    def _prepare_data(self, df: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray]:
        """Prepare data for LSTM training"""
        # Pivot data to have categories as columns
        pivot_data = df.pivot_table(
            index=['year', 'month'], 
            columns='category', 
            values='amount', 
            fill_value=0
        ).reset_index()
        
        # Sort by year and month
        pivot_data = pivot_data.sort_values(['year', 'month'])
        
        # Extract features (month, year) and targets (category amounts)
        features = pivot_data[['month', 'year']].values
        targets = pivot_data[self.categories].values
        
        # Scale the data
        features_scaled = self.scaler.fit_transform(features)
        targets_scaled = self.scaler.fit_transform(targets)
        
        # Create sequences for LSTM
        X, y = [], []
        for i in range(self.sequence_length, len(features_scaled)):
            X.append(features_scaled[i-self.sequence_length:i])
            y.append(targets_scaled[i])
        
        return np.array(X), np.array(y)
    
    def _create_lstm_model(self, input_shape: Tuple[int, int], output_dim: int) -> Sequential:
        """Create LSTM model architecture"""
        model = Sequential([
            LSTM(50, return_sequences=True, input_shape=input_shape),
            Dropout(0.2),
            LSTM(50, return_sequences=False),
            Dropout(0.2),
            Dense(25),
            Dense(output_dim)
        ])
        
        model.compile(
            optimizer=Adam(learning_rate=0.001),
            loss='mse',
            metrics=['mae']
        )
        
        return model
    
    def _train_model(self, df: pd.DataFrame):
        """Train the LSTM model"""
        try:
            # Prepare data
            X, y = self._prepare_data(df)
            
            if len(X) == 0:
                print("Insufficient data for training")
                return
            
            # Split data
            split_idx = int(0.8 * len(X))
            X_train, X_test = X[:split_idx], X[split_idx:]
            y_train, y_test = y[:split_idx], y[split_idx:]
            
            # Create model
            self.model = self._create_lstm_model(
                input_shape=(X.shape[1], X.shape[2]),
                output_dim=y.shape[1]
            )
            
            # Callbacks
            callbacks = [
                EarlyStopping(patience=10, restore_best_weights=True),
                ModelCheckpoint(
                    self.model_path, 
                    save_best_only=True, 
                    monitor='val_loss'
                )
            ]
            
            # Train model
            history = self.model.fit(
                X_train, y_train,
                validation_data=(X_test, y_test),
                epochs=100,
                batch_size=32,
                callbacks=callbacks,
                verbose=0
            )
            
            # Evaluate
            train_loss = self.model.evaluate(X_train, y_train, verbose=0)
            test_loss = self.model.evaluate(X_test, y_test, verbose=0)
            
            print(f"Training loss: {train_loss[0]:.4f}, Test loss: {test_loss[0]:.4f}")
            
            # Save scaler and categories
            self._save_components()
            
        except Exception as e:
            print(f"Error training model: {e}")
    
    def _save_components(self):
        """Save scaler and categories"""
        try:
            os.makedirs(os.path.dirname(self.scaler_path), exist_ok=True)
            joblib.dump(self.scaler, self.scaler_path)
            joblib.dump(self.categories, self.categories_path)
            print("Model components saved successfully")
        except Exception as e:
            print(f"Error saving components: {e}")
    
    def predict_spending(self, user_id: int, spending_data: List[Dict], 
                        target_month: int, target_year: int) -> Dict[str, Any]:
        """Predict spending for a specific month"""
        try:
            if not spending_data:
                return {
                    "success": False,
                    "error": "No spending data provided",
                    "predictions": []
                }
            
            # Convert spending data to DataFrame
            df = pd.DataFrame(spending_data)
            df['date'] = pd.to_datetime(df['date'])
            df['month'] = df['date'].dt.month
            df['year'] = df['date'].dt.year
            
            # Convert amount to numeric (handle string values)
            df['amount'] = pd.to_numeric(df['amount'], errors='coerce')
            # Drop rows with invalid amounts
            df = df.dropna(subset=['amount'])
            
            # Ensure category is a string and fill missing values
            if 'category' in df.columns:
                df['category'] = df['category'].fillna('other').astype(str)
            else:
                df['category'] = 'other'
            
            # Filter for expenses only (negative amounts)
            df = df[df['amount'] < 0]
            df['amount'] = df['amount'].abs()  # Make positive for prediction
            
            # Group by month/year and category
            monthly_spending = df.groupby(['year', 'month', 'category'])['amount'].sum().reset_index()
            
            # Create pivot table
            pivot_data = monthly_spending.pivot_table(
                index=['year', 'month'], 
                columns='category', 
                values='amount', 
                fill_value=0
            ).reset_index()
            
            # Ensure all categories are present
            for category in self.categories:
                if category not in pivot_data.columns:
                    pivot_data[category] = 0
            
            # Sort by year and month
            pivot_data = pivot_data.sort_values(['year', 'month'])
            
            if len(pivot_data) < self.sequence_length:
                # Not enough data for LSTM, use simple trend analysis
                return self._simple_prediction(pivot_data, target_month, target_year)
            
            # Prepare data for prediction
            features = pivot_data[['month', 'year']].values
            features_scaled = self.scaler.transform(features)
            
            # Create sequence for prediction
            if len(features_scaled) >= self.sequence_length:
                sequence = features_scaled[-self.sequence_length:]
                sequence = sequence.reshape(1, self.sequence_length, -1)
                
                # Make prediction
                prediction_scaled = self.model.predict(sequence, verbose=0)
                
                # Inverse transform
                prediction = self.scaler.inverse_transform(prediction_scaled)[0]
                
                # Create predictions list
                predictions = []
                for i, category in enumerate(self.categories):
                    predictions.append({
                        'category': category,
                        'predicted_amount': float(prediction[i]),
                        'confidence': 0.8
                    })
                
                return {
                    "success": True,
                    "predictions": predictions,
                    "method": "lstm_model",
                    "target_month": target_month,
                    "target_year": target_year
                }
            else:
                return self._simple_prediction(pivot_data, target_month, target_year)
                
        except Exception as e:
            print(f"Error in prediction: {e}")
            return {
                "success": False,
                "error": str(e),
                "predictions": []
            }
    
    def _simple_prediction(self, pivot_data: pd.DataFrame, 
                          target_month: int, target_year: int) -> Dict[str, Any]:
        """Simple prediction using trend analysis when insufficient data"""
        predictions = []
        
        for category in self.categories:
            if category in pivot_data.columns:
                # Calculate average spending for this category
                avg_spending = pivot_data[category].mean()
                
                # Add some seasonal adjustment
                seasonal_multiplier = self._get_seasonal_multiplier(target_month, category)
                predicted_amount = avg_spending * seasonal_multiplier
                
                predictions.append({
                    'category': category,
                    'predicted_amount': float(predicted_amount),
                    'confidence': 0.6
                })
            else:
                predictions.append({
                    'category': category,
                    'predicted_amount': 0.0,
                    'confidence': 0.3
                })
        
        return {
            "success": True,
            "predictions": predictions,
            "method": "trend_analysis",
            "target_month": target_month,
            "target_year": target_year
        }
    
    def _get_seasonal_multiplier(self, month: int, category: str) -> float:
        """Get seasonal multiplier for different categories"""
        seasonal_factors = {
            'food': {11: 1.1, 12: 1.2, 1: 1.1, 6: 1.0, 7: 1.0, 8: 1.0},
            'shopping': {11: 1.5, 12: 1.8, 1: 1.3, 6: 0.9, 7: 0.8, 8: 0.9},
            'entertainment': {11: 1.2, 12: 1.3, 1: 1.1, 6: 1.2, 7: 1.3, 8: 1.2},
            'travel': {6: 1.4, 7: 1.5, 8: 1.4, 11: 1.1, 12: 1.2, 1: 0.8},
            'utilities': {12: 1.2, 1: 1.3, 2: 1.2, 6: 1.1, 7: 1.2, 8: 1.1}
        }
        
        return seasonal_factors.get(category, {}).get(month, 1.0)
    
    def retrain_model(self, user_id: int, new_data: List[Dict]) -> Dict[str, Any]:
        """Retrain model with new data"""
        try:
            # Convert new data to DataFrame
            df = pd.DataFrame(new_data)
            df['date'] = pd.to_datetime(df['date'])
            df['month'] = df['date'].dt.month
            df['year'] = df['date'].dt.year
            
            # Convert amount to numeric (handle string values)
            df['amount'] = pd.to_numeric(df['amount'], errors='coerce')
            # Drop rows with invalid amounts
            df = df.dropna(subset=['amount'])
            
            # Ensure category is a string and fill missing values
            if 'category' in df.columns:
                df['category'] = df['category'].fillna('other').astype(str)
            else:
                df['category'] = 'other'
            
            # Filter for expenses only
            df = df[df['amount'] < 0]
            df['amount'] = df['amount'].abs()
            
            # Load existing training data
            try:
                existing_data = self._load_training_data()
                combined_data = pd.concat([existing_data, df], ignore_index=True)
            except:
                combined_data = df
            
            # Retrain model
            self._train_model(combined_data)
            
            return {
                "success": True,
                "message": "Model retrained successfully",
                "new_samples": len(df)
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def _load_training_data(self) -> pd.DataFrame:
        """Load existing training data"""
        training_data_path = os.path.join(os.getenv("MODEL_PATH", "../models"), "prediction_training_data.pkl")
        try:
            return joblib.load(training_data_path)
        except:
            return self._create_sample_data()
