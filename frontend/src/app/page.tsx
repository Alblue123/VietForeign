"use client";

import React, { useState } from 'react';
import HomePage from './upload/page';
import ConvertPage from './convert/page';

const VietForeignApp: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<'home' | 'convert'>('home');
  const [conversionData, setConversionData] = useState<ConversionData | null>(null);


  const handleConvert = (data: ConversionData) => {
    setConversionData(data);  // Store the data
    setCurrentPage('convert'); // Switch to convert page
  };

  const handleBackToHome = () => {
    setCurrentPage('home');
  };

  return (
    <>
      {currentPage === 'home' ? (
        <HomePage onConvert={handleConvert} />
      ) : (
        <ConvertPage onBackToHome={handleBackToHome} conversionData={conversionData} />
      )}
    </>
  );
};

export default VietForeignApp;