import React, { useState, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { Upload, Download, Eye, EyeOff, Loader2, Shield, FileText, Image as ImageIcon } from 'lucide-react';
import Tesseract from 'tesseract.js';

interface PIIMatch {
  type: string;
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface DetectedText {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

const PII_PATTERNS = {
  aadhaar: {
    pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    name: 'Aadhaar Number',
    color: '#ff4444'
  },
  phone: {
    pattern: /\b(?:\+91[\-\s]?)?[6-9]\d{9}\b/g,
    name: 'Phone Number',
    color: '#ff8844'
  },
  email: {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    name: 'Email Address',
    color: '#ffaa44'
  },
  pan: {
    pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g,
    name: 'PAN Number',
    color: '#44ff44'
  },
  dob: {
    pattern: /\b(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/g,
    name: 'Date of Birth',
    color: '#4488ff'
  },
  name: {
    pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g,
    name: 'Potential Name',
    color: '#8844ff'
  }
};

const PIIDetector: React.FC = () => {
  const [image, setImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [detectedPII, setDetectedPII] = useState<PIIMatch[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showMasked, setShowMasked] = useState(false);
  const [extractedText, setExtractedText] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const detectPII = useCallback((text: string, detectedWords: DetectedText[]): PIIMatch[] => {
    const matches: PIIMatch[] = [];
    
    Object.entries(PII_PATTERNS).forEach(([type, config]) => {
      const regex = new RegExp(config.pattern.source, 'gi');
      let match;
      
      while ((match = regex.exec(text)) !== null) {
        // Find the bounding box for this text match
        const matchText = match[0];
        const matchedWord = detectedWords.find(word => 
          word.text.toLowerCase().includes(matchText.toLowerCase()) ||
          matchText.toLowerCase().includes(word.text.toLowerCase())
        );
        
        if (matchedWord) {
          matches.push({
            type: config.name,
            text: matchText,
            confidence: matchedWord.confidence,
            bbox: matchedWord.bbox
          });
        }
      }
    });
    
    return matches;
  }, []);

  const processImage = useCallback(async (imageUrl: string) => {
    setIsProcessing(true);
    setProgress(0);
    
    try {
      // Create image element to get dimensions
      const img = new Image();
      img.src = imageUrl;
      await new Promise((resolve) => { img.onload = resolve; });
      
      // Perform OCR
      const { data } = await Tesseract.recognize(imageUrl, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            setProgress(Math.round(m.progress * 100));
          }
        }
      });
      
      setExtractedText(data.text);
      
      // Convert words to our format  
      const detectedWords: DetectedText[] = (data as any).words?.map((word: any) => ({
        text: word.text,
        bbox: word.bbox,
        confidence: word.confidence
      })) || [];
      
      // Detect PII
      const piiMatches = detectPII(data.text, detectedWords);
      setDetectedPII(piiMatches);
      
      // Create masked image
      await createMaskedImage(imageUrl, piiMatches, img.width, img.height);
      
      toast({
        title: "Processing Complete",
        description: `Found ${piiMatches.length} PII instances`,
      });
      
    } catch (error) {
      console.error('Error processing image:', error);
      toast({
        title: "Processing Failed",
        description: "Failed to process the image. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  }, [detectPII]);

  const createMaskedImage = useCallback(async (
    imageUrl: string, 
    piiMatches: PIIMatch[], 
    originalWidth: number, 
    originalHeight: number
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const img = new Image();
    img.src = imageUrl;
    
    await new Promise((resolve) => { img.onload = resolve; });
    
    // Set canvas size to match image
    canvas.width = originalWidth;
    canvas.height = originalHeight;
    
    // Draw original image
    ctx.drawImage(img, 0, 0);
    
    // Apply masks
    piiMatches.forEach(match => {
      const { bbox } = match;
      
      // Create rounded rectangle mask
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(bbox.x0, bbox.y0, bbox.x1 - bbox.x0, bbox.y1 - bbox.y0);
      
      // Add icon
      ctx.fillStyle = 'white';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('🔒', bbox.x0 + (bbox.x1 - bbox.x0) / 2, bbox.y0 + (bbox.y1 - bbox.y0) / 2 + 6);
    });
    
    // Convert to data URL
    const maskedImageUrl = canvas.toDataURL('image/png');
    setProcessedImage(maskedImageUrl);
  }, []);

  const handleImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid File",
        description: "Please select an image file.",
        variant: "destructive"
      });
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setImage(result);
      setProcessedImage(null);
      setDetectedPII([]);
      setExtractedText('');
      processImage(result);
    };
    reader.readAsDataURL(file);
  }, [processImage]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setImage(result);
        setProcessedImage(null);
        setDetectedPII([]);
        setExtractedText('');
        processImage(result);
      };
      reader.readAsDataURL(file);
    }
  }, [processImage]);

  const downloadProcessedImage = useCallback(() => {
    if (!processedImage) return;
    
    const link = document.createElement('a');
    link.href = processedImage;
    link.download = 'masked-image.png';
    link.click();
  }, [processedImage]);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Shield className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              PII Shield
            </h1>
          </div>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Automatically detect and mask Personally Identifiable Information in documents. 
            Protect privacy by obscuring sensitive data like Aadhaar numbers, phone numbers, and more.
          </p>
        </div>

        {/* Upload Area */}
        {!image && (
          <Card className="border-dashed border-2 border-primary/30 hover:border-primary/60 transition-colors">
            <CardContent className="p-12">
              <div
                className="text-center cursor-pointer"
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-16 w-16 text-primary mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">Upload ID Document</h3>
                <p className="text-muted-foreground mb-4">
                  Drag and drop an image file or click to browse
                </p>
                <p className="text-sm text-muted-foreground">
                  Supports: JPG, PNG, GIF (Max 10MB)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Processing Progress */}
        {isProcessing && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="font-medium">Processing Image...</span>
              </div>
              <Progress value={progress} className="w-full" />
              <p className="text-sm text-muted-foreground mt-2">{progress}% complete</p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {image && !isProcessing && (
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Image Display */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <ImageIcon className="h-5 w-5" />
                    {showMasked && processedImage ? 'Masked Image' : 'Original Image'}
                  </h3>
                  <div className="flex gap-2">
                    {processedImage && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowMasked(!showMasked)}
                        >
                          {showMasked ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          {showMasked ? 'Show Original' : 'Show Masked'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={downloadProcessedImage}
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setImage(null);
                        setProcessedImage(null);
                        setDetectedPII([]);
                        setExtractedText('');
                      }}
                    >
                      Upload New
                    </Button>
                  </div>
                </div>
                <div className="relative bg-muted rounded-lg overflow-hidden">
                  <img
                    src={showMasked && processedImage ? processedImage : image}
                    alt="Document"
                    className="w-full h-auto max-h-96 object-contain"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Detection Results */}
            <div className="space-y-6">
              {/* PII Detected */}
              <Card>
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    PII Detected ({detectedPII.length})
                  </h3>
                  {detectedPII.length > 0 ? (
                    <div className="space-y-3">
                      {detectedPII.map((pii, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                          <div>
                            <Badge variant="outline" className="mb-1">
                              {pii.type}
                            </Badge>
                            <p className="text-sm font-mono bg-background px-2 py-1 rounded">
                              {pii.text}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">
                              Confidence: {Math.round(pii.confidence)}%
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No PII detected in this image.</p>
                  )}
                </CardContent>
              </Card>

              {/* Extracted Text */}
              {extractedText && (
                <Card>
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Extracted Text
                    </h3>
                    <div className="bg-muted rounded-lg p-4 max-h-48 overflow-y-auto">
                      <pre className="text-sm whitespace-pre-wrap">{extractedText}</pre>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* Hidden Canvas */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
};

export default PIIDetector;